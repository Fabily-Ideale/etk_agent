#!/bin/sh
set -e
npx prisma db push
exec node cod_result/server.js
