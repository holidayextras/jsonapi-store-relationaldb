# jsonapi-store-relationaldb

`jsonapi-server-relationaldb` is a relationanal database backed data store for [`jsonapi-server`](https://github.com/holidayextras/jsonapi-server).

This project conforms to the specification laid out in the [jsonapi-server handler documentation](https://github.com/holidayextras/jsonapi-server/blob/master/documentation/handlers.md).

### Supported Databases

 * Postgres
 * MySQL
 * MariaDB
 * SQLite
 * Microsoft SQL Server

### Usage

```
jsonApi.define({
  resource: "comments",
  handlers: new jsonApi.SqlHandler({
    dialect: "mysql",
    host: "localhost",
    port: 3306,
    username: "root",
    password: null,
    logging: false
  })
});
```

### Features

 * Search, Find, Create, Delete, Update
 * Efficient lookups via appropriate indexes
 * Filtering happens at the database layer
 * Transactional queries

### Gotchas

Relational databases don't differentiate between `undefined` and `null` values. `Joi` does differentiate between `undefined` and `null` values. Some `undefined` properties will pass validation, whilst `null` properties may not. For example, the default articles resource contains a `created` attribute of type `"date"` - this won't pass validation with a `null` value, so the Joi schema will need tweaking.
