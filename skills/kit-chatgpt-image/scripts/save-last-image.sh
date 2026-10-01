#!/bin/sh
# 사용: sh save-last-image.sh SPACE OUT_ABS_PNG
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
{
  printf 'Object.assign(process.env, %s);\n' "$(python3 -c 'import json,sys; print(json.dumps({"SPACE":sys.argv[1],"OUT":sys.argv[2]}))' "$1" "$2")"
  cat "$DIR/save-last-image.mjs"
} | ego-browser nodejs
