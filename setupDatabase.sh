#!/bin/bash -x

DB=$1
mysql -u root -e "DROP DATABASE IF EXISTS \`$DB\`"
mysql -u root -e "CREATE DATABASE \`$DB\`"
