#!/bin/bash
# Brings an Amazon Linux 2023 host to a running Open Insights server, from whatever
# state it is in. Run as root on the instance:
#
#   bootstrap.sh <stack-name> <region>
#
# The instance's UserData runs it on first boot, and deploy.sh runs it again over SSM
# Run Command for every update, so every step is safe to repeat. It checks out the
# commit in /<stack>/git-ref first and re-runs itself from that commit, so the script
# that does the work is always the one versioned with the code it deploys.
set -euo pipefail

STACK=${1:?usage: bootstrap.sh <stack-name> <region>}
REGION=${2:?usage: bootstrap.sh <stack-name> <region>}

ROOT=/opt/open-insights
SRC=$ROOT/src
# The data volume's mount point. DATA_DIR (server.env) and the Caddy bind mounts in
# docker-compose.aws.yml are both under it.
PERSIST=$ROOT/persist

# UserData and deploy.sh can both start a run on a fresh instance; take turns.
exec 9>/run/open-insights-bootstrap.lock
flock 9

param() {
	aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \
		--query Parameter.Value --output text
}

log() { echo "[bootstrap $(date -u +%H:%M:%S)] $*"; }

# --- 1. The commit to run.
ref=$(param "/$STACK/git-ref")
if [ "${OI_BOOTSTRAP_REEXEC:-}" != "$ref" ]; then
	log "checking out $ref"
	git -C "$SRC" fetch --quiet origin
	git -C "$SRC" checkout --quiet --detach "$ref"
	# The lock is held through fd 9, which survives the exec.
	OI_BOOTSTRAP_REEXEC=$ref exec bash "$SRC/deploy/aws/bootstrap.sh" "$@"
fi

# shellcheck source=deploy/aws/versions.env
. "$SRC/deploy/aws/versions.env"

# --- 2. Swap. 2GB of RAM is tight for the image build's pip step and for Whisper and
# OCR running at once; this turns an OOM kill into a slow minute.
if [ ! -f /swapfile ]; then
	log "adding 2GB swap"
	dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
	chmod 600 /swapfile
	mkswap /swapfile >/dev/null
	echo '/swapfile none swap defaults 0 0' >>/etc/fstab
fi
swapon --show=NAME --noheadings | grep -qx /swapfile || swapon /swapfile

# --- 3. The data volume. On Nitro it appears as NVMe, named by its volume ID rather
# than the /dev/xvdf the template attached it as. It can arrive a little after boot.
vol=$(param "/$STACK/data-volume-id")
dev=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${vol//-/}
for _ in $(seq 60); do [ -e "$dev" ] && break; sleep 5; done
[ -e "$dev" ] || { log "data volume $vol never appeared"; exit 1; }

# Formatted only when it is blank - a reattached volume keeps its data.
if ! blkid "$dev" >/dev/null; then
	log "formatting new data volume $vol"
	mkfs.ext4 -q -L oi-data "$dev"
fi
uuid=$(blkid -s UUID -o value "$dev")
mkdir -p "$PERSIST"
if ! grep -q "UUID=$uuid" /etc/fstab; then
	echo "UUID=$uuid $PERSIST ext4 defaults,nofail 0 2" >>/etc/fstab
fi
mountpoint -q "$PERSIST" || mount "$PERSIST"

# The server container runs as uid 1000 (see server/Dockerfile) and dies on boot if
# it cannot create its upload directory.
mkdir -p "$PERSIST/data" "$PERSIST/caddy/data" "$PERSIST/caddy/config"
chown 1000:1000 "$PERSIST/data"

# --- 4. Docker, from the AMI's own pinned repository, plus the Compose and buildx
# plugins it does not package, at the versions and checksums in versions.env.
if ! command -v docker >/dev/null; then
	log "installing docker"
	dnf install -y docker
fi
systemctl enable --now docker

plugins=/usr/local/lib/docker/cli-plugins
mkdir -p "$plugins"
install_plugin() { # name url sha256
	if [ -x "$plugins/$1" ] && echo "$3  $plugins/$1" | sha256sum -c --status; then
		return
	fi
	log "installing $1 from $2"
	curl -fsSL -o "$plugins/$1.tmp" "$2"
	echo "$3  $plugins/$1.tmp" | sha256sum -c --quiet
	chmod 755 "$plugins/$1.tmp"
	mv "$plugins/$1.tmp" "$plugins/$1"
}
install_plugin docker-compose \
	"https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
	"$COMPOSE_SHA256"
install_plugin docker-buildx \
	"https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-amd64" \
	"$BUILDX_SHA256"

# --- 5. .env: the committed settings, then the keys from SSM. Rewritten every run, so
# a rotated key takes effect on the next deploy.
umask 077
{
	echo "# Written by deploy/aws/bootstrap.sh on every deploy - edit server.env or SSM instead."
	grep -v '^#' "$SRC/deploy/aws/server.env"
	echo "PUBLIC_API_KEY=$(param /open-insights/public-api-key)"
	echo "PRIVATE_API_KEY=$(param /open-insights/private-api-key)"
} >"$SRC/.env.tmp"
mv "$SRC/.env.tmp" "$SRC/.env"
umask 022

# --- 6. Build and start.
cd "$SRC"
compose() { docker compose -f docker-compose.yml -f deploy/aws/docker-compose.aws.yml "$@"; }
log "building and starting"
compose up -d --build --remove-orphans

# The Dockerfile's healthcheck allows a 120s start period for the weights to load.
server=$(compose ps -q server)
for _ in $(seq 60); do
	status=$(docker inspect --format '{{.State.Health.Status}}' "$server")
	[ "$status" = healthy ] && break
	sleep 10
done
if [ "$status" != healthy ]; then
	log "server is $status after 10 minutes"
	compose logs --tail 100 server
	exit 1
fi

# Old images from previous commits; the build cache is kept so the next build reuses
# the pip layer.
docker image prune -f >/dev/null
log "running $ref, server healthy"
