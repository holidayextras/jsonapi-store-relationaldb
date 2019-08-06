#!/bin/bash -x

DB=$1
DIALECT=${2:-mysql}

case "$DIALECT" in
    mysql)
        /usr/local/bin/mysql.server start
        mysql -e "ALTER USER root IDENTIFIED WITH mysql_native_password BY \'\'"
        mysql -u root -e "DROP DATABASE IF EXISTS \`$DB\`"
        mysql -u root -e "CREATE DATABASE \`$DB\`"
        ;;
    postgres)
        psql -c "DROP DATABASE IF EXISTS \"$DB\"" postgres postgres
        psql -c "CREATE DATABASE \"$DB\"" postgres postgres
        ;;
    sqlite)
        ;;
    mssql)
        sqlcmd -u sa -P '' -Q "DROP DATABASE IF EXISTS \`$DB\`"
        sqlcmd -u sa -P '' -Q "CREATE DATABASE \`$DB\`"
        ;;
    *)
        echo "unknown database dialect: $DIALECT"
        exit 1
esac
