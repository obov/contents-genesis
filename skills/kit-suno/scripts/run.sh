#!/bin/sh
# 사용: sh run.sh SCRIPT.mjs ENV_JSON
# ego-browser nodejs는 셸 env·cwd를 받지 않음 → ENV_JSON을 process.env에 주입한 뒤 스크립트를 파이프
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
{
  printf 'Object.assign(process.env, %s);\n' "$2"
  cat "$DIR/$1"
} | ego-browser nodejs
