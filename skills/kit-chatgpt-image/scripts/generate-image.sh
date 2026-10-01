#!/bin/sh
# 사용: sh generate-image.sh SPACE OUT_ABS_PNG "프롬프트" [첨부파일 절대경로...]
# 새 채팅: NEW_CHAT=1 sh generate-image.sh ...
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
SPACE=$1; OUT=$2; PROMPT=$3; shift 3
{
  printf 'Object.assign(process.env, %s);\n' "$(python3 -c 'import json,sys,os; print(json.dumps({"SPACE":sys.argv[1],"OUT":sys.argv[2],"PROMPT":sys.argv[3],"FILES":json.dumps(sys.argv[4:],ensure_ascii=False),"NEW_CHAT":os.environ.get("NEW_CHAT","")},ensure_ascii=False))' "$SPACE" "$OUT" "$PROMPT" "$@")"
  cat "$DIR/generate-image.mjs"
} | ego-browser nodejs
