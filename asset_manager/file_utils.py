from utils import *
import csv
from typing import Dict
from typing import List

def parse_csv_to_dict(
    file_path: Path, *, delimiter: str = ",", has_header: bool = True
) -> Dict[str, List[str]]:
    with open(file_path, newline="", encoding="utf-8") as f:
        if has_header:
            reader = csv.DictReader(f, delimiter=delimiter)
            if reader.fieldnames is None:
                return {}
            out: Dict[str, List[str]] = {name: [] for name in reader.fieldnames}
            for row in reader:
                for k, v in row.items():
                    out[k].append("" if v is None else v)
            return out
        else:
            reader = csv.reader(f, delimiter=delimiter)
            out: Dict[str, List[str]] = {}
            for row in reader:
                for i, cell in enumerate(row):
                    key = f"column{i}"
                    out.setdefault(key, []).append(cell)
            return out