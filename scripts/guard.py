#!/usr/bin/env python3
"""PreToolUse(Bash) 가드 — 위험한 명령어를 차단한다.

Claude Code는 hook 입력을 환경변수가 아니라 stdin의 JSON으로 전달한다.
exit code 2 = 도구 실행 차단 + stderr를 에이전트에게 피드백.
"""

import json
import re
import sys

DANGEROUS = re.compile(
    r"rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|DROP\s+TABLE",
    re.IGNORECASE,
)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0

    command = payload.get("tool_input", {}).get("command", "")
    if DANGEROUS.search(command):
        print("BLOCKED: 위험한 명령어가 감지되었습니다.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
