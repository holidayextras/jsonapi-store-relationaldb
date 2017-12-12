[![Coverage Status](https://coveralls.io/repos/holidayextras/jsonapi-store-relationaldb/badge.svg?branch=master&service=github)](https://coveralls.io/github/holidayextras/jsonapi-store-relationaldb?branch=master)
[![Build Status](https://travis-ci.org/holidayextras/jsonapi-store-relationaldb.svg?branch=master)](https://travis-ci.org/holidayextras/jsonapi-store-relationaldb)
[![npm version](https://badge.fury.io/js/jsonapi-store-relationaldb.svg)](http://badge.fury.io/js/jsonapi-store-relationaldb)
[![Code Climate](https://codeclimate.com/github/holidayextras/jsonapi-store-relationaldb/badges/gpa.svg)](https://codeclimate.com/github/holidayextras/jsonapi-store-relationaldb)
[![Dependencies Status](https://david-dm.org/holidayextras/jsonapi-store-relationaldb.svg)](https://david-dm.org/holidayextras/jsonapi-store-relationaldb)

# jsonapi-store-relationaldb

#### :warning: PLEASE NOTE: Version 4.x releases erroneously created columns for `string` properties as Sequelize `text` type. The behaviour in version 5.x has reverted back to creating columns with the Sequelize `string` type, which is the more adequate type and was the behaviour in versions 3.x and older. The `text` columns created by version 4.x will need to be manually migrated to `string` columns.

`jsonapi-store-relationaldb` is a relational database backed data store for [`jsonapi-server`](https://github.com/holidayextras/jsonapi-server).

This project conforms to the specification laid out in the [jsonapi-server handler documentation](https://github.com/holidayextras/jsonapi-server/blob/master/documentation/handlers.md).

### Supported Databases

 * Postgres
 * MySQL
 * MariaDB

### Usage

```javascript
var RelationalDbStore = require("jsonapi-store-relationaldb");

jsonApi.define({
  resource: "comments",
  handlers: new RelationalDbStore({
    dialect: "mysql",
    dialectOptions: {
      supportBigNumbers: true
    },
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

#### Alternative Usage - Provide Sequelize instance

If you are already using sequelize or need to have access to the sequelize instance, you may provide an instance to the store to be used instead of having the store create a new instance from the given config.

```javascript
var RelationalDbStore = require("jsonapi-store-relationaldb");
var Sequelize = require("Sequelize");

var sequelize = new Sequelize("jsonapi", "root", null, {dialect: "mysql"}));

jsonApi.define({
  resource: "comments",
  handlers: new RelationalDbStore({
    sequelize: sequelize
  })
});
```

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

**Note:** When populating database tables, you can use the `force` config option to DROP and CREATE tables. This is helpful in development stage, when your data doesn't matter and you want your Tables schemas to change according to the DAOs without having to manually write migrations.

```js
(new RelationalDbStore()).populate({force: true}, () => {
  //tables dropped and created
})
```

### Gotchas

Relational databases don't differentiate between `undefined` and `null` values. `Joi` does differentiate between `undefined` and `null` values. Some `undefined` properties will pass validation, whilst `null` properties may not. For example, the default articles resource contains a `created` attribute of type `"date"` - this won't pass validation with a `null` value, so the Joi schema will need tweaking.
