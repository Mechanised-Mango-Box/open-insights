#!/bin/bash
# Deploys the Open Insights API server to AWS from the commit you have checked out.
# Run from anywhere in the repository, after `aws login`:
#
#   deploy/aws/deploy.sh pin-ami        # once, then commit params.<region>
#   deploy/aws/deploy.sh secrets        # once per account: the two API keys into SSM
#   deploy/aws/deploy.sh budget-check   # once per account: is billing visible to budgets?
#   ALERT_EMAIL=you@example.com deploy/aws/deploy.sh up   # ALERT_EMAIL only on first create
#   DUCKDNS_TOKEN=... deploy/aws/deploy.sh dns
#
# then `up` again for every new commit, and `status`, `logs`, `start` or `destroy`.
#
# STACK (default open-insights) and AWS_REGION (default ap-southeast-2) pick the
# stack, so a throwaway copy can run beside the real one:
#
#   STACK=open-insights-repro deploy/aws/deploy.sh up
set -euo pipefail

STACK=${STACK:-open-insights}
REGION=${AWS_REGION:-ap-southeast-2}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
PARAMS=$HERE/params.$REGION
export AWS_REGION=$REGION AWS_PAGER=""

die() { echo "deploy: $*" >&2; exit 1; }

output() {
	aws cloudformation describe-stacks --stack-name "$STACK" \
		--query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

stack_exists() { aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1; }

# Runs a shell command on the instance as root over SSM Run Command and prints its
# output. The aws CLI's own waiter gives up after 100s, which an image build outlasts.
ssm_run() { # command [timeout-seconds]
	local id cmd status
	id=$(output InstanceId)
	cmd=$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
		--timeout-seconds 600 \
		--parameters "$(jq -cn --arg c "$1" --arg t "${2:-600}" \
			'{commands: [$c], executionTimeout: [$t]}')" \
		--query Command.CommandId --output text)
	while :; do
		sleep 5
		status=$(aws ssm get-command-invocation --command-id "$cmd" --instance-id "$id" \
			--query Status --output text 2>/dev/null || echo Pending)
		case $status in Pending | InProgress | Delayed) ;; *) break ;; esac
	done
	aws ssm get-command-invocation --command-id "$cmd" --instance-id "$id" \
		--query '[StandardOutputContent, StandardErrorContent]' --output text
	[ "$status" = Success ] || die "command on $id finished $status"
}

wait_for_ssm() {
	local id
	id=$(output InstanceId)
	echo "waiting for $id to register with SSM..."
	for _ in $(seq 60); do
		[ "$(aws ssm describe-instance-information \
			--filters "Key=InstanceIds,Values=$id" \
			--query 'InstanceInformationList[0].PingStatus' --output text)" = Online ] && return
		sleep 10
	done
	die "$id never came online in SSM"
}

cmd_pin_ami() {
	local ami
	ami=$(aws ssm get-parameter \
		--name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
		--query Parameter.Value --output text)
	sed -i "s/^ImageId=.*/ImageId=$ami/" "$PARAMS"
	echo "pinned $ami in $PARAMS - commit it"
}

cmd_secrets() {
	# The public key is the one already shipped in the client bundle; reading it from
	# there means the server and client cannot disagree about it.
	local public private
	public=$(sed -n "s/^export const DEFAULT_API_KEY = '\(.*\)';$/\1/p" \
		"$REPO/client/src/app/data-management/server-config.service.ts")
	[ -n "$public" ] || die "could not read DEFAULT_API_KEY from server-config.service.ts"
	aws ssm put-parameter --name /open-insights/public-api-key --type String \
		--value "$public" --overwrite >/dev/null
	echo "public-api-key set from the client"

	if aws ssm get-parameter --name /open-insights/private-api-key >/dev/null 2>&1; then
		echo "private-api-key already exists - left alone (delete it to rotate)"
	else
		private=$(/usr/bin/python3 -c "import secrets; print(secrets.token_urlsafe(24))")
		aws ssm put-parameter --name /open-insights/private-api-key --type SecureString \
			--value "$private" >/dev/null
		echo "private-api-key generated; read it back with:"
		echo "  aws ssm get-parameter --region $REGION --name /open-insights/private-api-key --with-decryption --query Parameter.Value --output text"
	fi
}

cmd_budget_check() {
	# Budgets and their actions only work if billing data is visible. Cost Explorer
	# answering is the quickest proof of that; it also gives this month's spend, which
	# the budget counts across the whole account, not just this stack.
	local start end spent
	start=$(date -u +%Y-%m-01)
	end=$(date -u -d tomorrow +%Y-%m-%d)
	spent=$(aws ce get-cost-and-usage --region us-east-1 \
		--time-period "Start=$start,End=$end" --granularity MONTHLY \
		--metrics UnblendedCost --query 'ResultsByTime[0].Total.UnblendedCost.Amount' \
		--output text) || die "Cost Explorer is not answering: enable it in the Billing console, and IAM access to billing if you are not the root user"
	printf 'spent so far this month, whole account: US$%.2f\n' "$spent"
	echo "running instances in $REGION, by stack (all count against the budget):"
	aws ec2 describe-instances --filters Name=instance-state-name,Values=running \
		--query "Reservations[].Instances[].[InstanceId, InstanceType, Tags[?Key=='aws:cloudformation:stack-name'] | [0].Value]" \
		--output text
}

cmd_up() {
	local ref existed=0
	[ -z "$(git -C "$REPO" status --porcelain)" ] || die "working tree is not clean - commit first"
	ref=$(git -C "$REPO" rev-parse HEAD)
	git -C "$REPO" fetch --quiet origin
	[ -n "$(git -C "$REPO" branch -r --contains "$ref")" ] ||
		die "$ref is not on origin - push it first, the instance clones from there"
	grep -q '^ImageId=ami-' "$PARAMS" || die "no AMI pinned in $PARAMS - run pin-ami"
	aws ssm get-parameter --name /open-insights/private-api-key >/dev/null 2>&1 ||
		die "no API keys in SSM - run secrets"

	local overrides
	mapfile -t overrides < <(grep -v -e '^#' -e '^$' "$PARAMS")
	overrides+=("GitRef=$ref")
	if stack_exists; then
		existed=1
	else
		[ -n "${ALERT_EMAIL:-}" ] || die "set ALERT_EMAIL for the budget alerts on first create"
	fi
	[ -n "${ALERT_EMAIL:-}" ] && overrides+=("AlertEmail=$ALERT_EMAIL")

	echo "deploying $ref to stack $STACK in $REGION..."
	aws cloudformation deploy --stack-name "$STACK" \
		--template-file "$HERE/open-insights.yaml" \
		--parameter-overrides "${overrides[@]}" \
		--capabilities CAPABILITY_IAM --no-fail-on-empty-changeset

	wait_for_ssm
	# On a new stack this waits behind the UserData run (bootstrap.sh takes a lock)
	# and then confirms it; on an existing one it moves the host to $ref.
	[ $existed = 1 ] && echo "updating the host to $ref..." || echo "waiting for first boot..."
	ssm_run "bash /opt/open-insights/src/deploy/aws/bootstrap.sh $STACK $REGION" 3600
	echo "up: $STACK at $(output PublicIp), running $ref"
}

cmd_dns() {
	local ip host sub
	[ -n "${DUCKDNS_TOKEN:-}" ] || die "set DUCKDNS_TOKEN"
	ip=$(output PublicIp)
	host=$(sed -n 's/^SITE_ADDRESS=//p' "$HERE/server.env")
	sub=${host%.duckdns.org}
	[ "$sub" != "$host" ] || die "SITE_ADDRESS $host is not a DuckDNS name"
	[ "$(curl -fsS "https://www.duckdns.org/update?domains=$sub&token=$DUCKDNS_TOKEN&ip=$ip")" = OK ] ||
		die "DuckDNS refused the update"
	echo "pointed $host at $ip; waiting for it to resolve..."
	for _ in $(seq 30); do
		[ "$(dig +short @1.1.1.1 "$host" A 2>/dev/null)" = "$ip" ] && break
		sleep 10
	done
	# Caddy backs off after failing HTTP-01 while the name still pointed elsewhere;
	# a restart makes it try again now.
	ssm_run "cd /opt/open-insights/src && docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml restart caddy"
	echo "check: curl -sI https://$host/status"
}

cmd_status() {
	ssm_run "cd /opt/open-insights/src && git rev-parse HEAD && docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml ps && df -h /opt/open-insights/persist"
}

cmd_logs() {
	ssm_run "cd /opt/open-insights/src && docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml logs --tail ${TAIL:-100}"
}

cmd_start() {
	# After the budget action has stopped the instance. The containers restart on
	# their own (restart: unless-stopped).
	aws ec2 start-instances --instance-ids "$(output InstanceId)" >/dev/null
	echo "starting $(output InstanceId)"
}

cmd_destroy() {
	read -rp "Delete stack $STACK in $REGION? Its data volume is kept as a snapshot. [y/N] " ok
	[ "$ok" = y ] || exit 1
	aws cloudformation delete-stack --stack-name "$STACK"
	aws cloudformation wait stack-delete-complete --stack-name "$STACK"
	echo "deleted $STACK"
}

case ${1:-} in
	pin-ami) cmd_pin_ami ;;
	secrets) cmd_secrets ;;
	budget-check) cmd_budget_check ;;
	up) cmd_up ;;
	dns) cmd_dns ;;
	status) cmd_status ;;
	logs) cmd_logs ;;
	start) cmd_start ;;
	destroy) cmd_destroy ;;
	*) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
