#!/bin/sh
set -e
# 以非 root 身份启动 nginx（前台运行）
exec nginx -g 'daemon off;'
