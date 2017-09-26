[![Coverage Status](https://coveralls.io/repos/holidayextras/jsonapi-store-relationaldb/badge.svg?branch=master&service=github)](https://coveralls.io/github/holidayextras/jsonapi-store-relationaldb?branch=master)
[![Build Status](https://travis-ci.org/holidayextras/jsonapi-store-relationaldb.svg?branch=master)](https://travis-ci.org/holidayextras/jsonapi-store-relationaldb)
[![npm version](https://badge.fury.io/js/jsonapi-store-relationaldb.svg)](http://badge.fury.io/js/jsonapi-store-relationaldb)
[![Code Climate](https://codeclimate.com/github/holidayextras/jsonapi-store-relationaldb/badges/gpa.svg)](https://codeclimate.com/github/holidayextras/jsonapi-store-relationaldb)
[![Dependencies Status](https://david-dm.org/holidayextras/jsonapi-store-relationaldb.svg)](https://david-dm.org/holidayextras/jsonapi-store-relationaldb)


# jsonapi-store-relationaldb

`jsonapi-store-relationaldb` is a relational database backed data store for [`jsonapi-server`](https://github.com/holidayextras/jsonapi-server).

This project conforms to the specification laid out in the [jsonapi-server handler documentation](https://github.com/holidayextras/jsonapi-server/blob/master/documentation/handlers.md).

### Supported Databases

 * Postgres
 * MySQL
 * MariaDB
 * SQLite
 * Microsoft SQL Server

### Usage

```javascript
var RelationalDbStore = require("jsonapi-store-relationaldb");

jsonApi.define({
  resource: "comments",
  handlers: new RelationalDbStore({
    dialect: "mysql",
    host: "localhost",
    port: 3306,
    database: "jsonapi", // If not provided, defaults to the name of the resource
    username: "root",
    password: null,
    logging: false
  })
});
```

**Note:** the `logging` property controls the logging of the emitted SQL and can either be `false` (which will mean it will be captured by the internal debugging module under the namespace `jsonApi:store:relationaldb:sequelize`) or a user provided function (e.g. `console.log`) to which a string containing the information to be logged will be passed as the first argument.

### Features

 * Search, Find, Create, Delete, Update
 * Efficient lookups via appropriate indexes
 * Filtering happens at the database layer
 * Transactional queries


### Getting to Production

Getting this data store to production isn't too bad...

1. Bring up your relational database stack.
2. Create the database(s).
3. Create the database tables. You can call `(new RelationalDbStore()).populate()` to have this module attempt to create the require tables. If you enable debugging via `DEBUG=jsonApi:store:*` you'll see the create-table statements - you can target a local database, call populate(), grab the queries, review them and finally run them against your production stack manually.
3. Deploy your code.
4. Celebrate.

When deploying schema changes, you'll need to correct your database schema - database migrations are left as an exercise for the user. If your schema are likely to change frequently, maybe consider using a different (less schema-driven) data store.

When changing columns in a production database, a typical approach might be to create a new table that is a clone of the table in production, copy all data from the production table into the new table, run an ALTER-TABLE command on the new table to adjust the columns (this may take a while and will lock the table), then run a RENAME-TABLES to swap the production table out for the new one.

NOTE: 
When populating database tables, you can use the `force` config option to DROP and CREATE tables.
This is helpful in development stage, when your data doesn't matter and you
want your Tables schemas to change according to the DAOs without having to
manually write migrations

```js
(new RelationalDbStore()).populate({force: true}, () => {
  //tables dropped and created
})
```

### Gotchas

Relational databases don't differentiate between `undefined` and `null` values. `Joi` does differentiate between `undefined` and `null` values. Some `undefined` properties will pass validation, whilst `null` properties may not. For example, the default articles resource contains a `created` attribute of type `"date"` - this won't pass validation with a `null` value, so the Joi schema will need tweaking.
