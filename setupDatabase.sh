#!/bin/bash -x

DB=$1
DIALECT=${2:-mysql}

case "$DIALECT" in
    mysql)
        mysql -u root -e "DROP DATABASE IF EXISTS \`$DB\`"
        mysql -u root -e "CREATE DATABASE \`$DB\`"
        ;;
    postgres)
        psql -c "DROP DATABASE IF EXISTS \"$DB\"" postgres postgres
        psql -c "CREATE DATABASE \"$DB\"" postgres postgres
        ;;
    sqlite)
        ;;
    *)
        echo "unknown database dialect: $DIALECT"
        exit 1
esac
