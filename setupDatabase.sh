#!/bin/bash -x

for database in jsonapi
do
  mysql -u root -e"DROP DATABASE IF EXISTS $database"
  mysql -u root -e"CREATE DATABASE $database"
done
