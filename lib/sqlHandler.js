"use strict";
// http://docs.sequelizejs.com/en/latest/
var Sequelize = require("sequelize");
var DataTypes = Sequelize.DataTypes;
var async = require("async");
var crypto = require("crypto");
var debug = require("debug")("jsonApi:store:relationaldb");
var Joi = require("joi");
var semver = require("semver");
var _ = require("lodash");
var util = require('util');

var MIN_SERVER_VERSION = "1.10.0";

var SqlStore = module.exports = function SqlStore(config) {
  SqlStore._checkMinServerVersion();
  this.config = config;
};

SqlStore._sequelizeInstances = Object.create(null);

/**
  Handlers readiness status. This should be set to `true` once all handlers are ready to process requests.
 */
SqlStore.prototype.ready = false;

SqlStore._checkMinServerVersion = function() {
  var serverVersion = require("jsonapi-server")._version;
  if (!serverVersion) return;
  if (semver.lt(serverVersion, MIN_SERVER_VERSION)) {
    throw new Error("This version of jsonapi-store-mongodb requires jsonapi-server>=" + MIN_SERVER_VERSION + ".");
  }
};

/**
  initialise gets invoked once for each resource that uses this hander.
  In this instance, we're instantiating a Sequelize instance and building models.
 */
SqlStore.prototype.initialise = function(resourceConfig) {
  var self = this;
  self.resourceConfig = resourceConfig;

  var database = self.config.database || resourceConfig.resource;
  var sequelizeArgs = [database, self.config.username, self.config.password, {
    dialect: self.config.dialect,
    host: self.config.host,
    port: self.config.port,
    logging: self.config.logging || require("debug")("jsonApi:store:relationaldb:sequelize"),
    define: {
      // Set freezeTableName on all table definitions to prevent sequelize from pluralizing
      // all table names by itself.
      freezeTableName: true
    }
  }];

  // To prevent too many open connections, we will store all Sequelize instances in a hash map.
  // Index the hash map by a hash of the entire config object. If the same config is passed again,
  // reuse the existing Sequelize connection resource instead of opening a new one.

  var md5sum = crypto.createHash("md5");
  var instanceId = md5sum.update(JSON.stringify(sequelizeArgs)).digest("hex");
  var instances = SqlStore._sequelizeInstances;

  if (!instances[instanceId]) {
    var sequelize = new (Function.prototype.bind.apply(Sequelize, [null].concat(sequelizeArgs)))();
    instances[instanceId] = sequelize;
  }

  self.sequelize = instances[instanceId];

  self._buildModels();

  self.ready = true;
};

SqlStore.prototype.populate = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var self = this;

  var tasks = [
    function(cb) {
      self.baseModel.sync(options).asCallback(cb);
    },
    function(cb) {
      async.eachSeries(self.relationArray, function(model, ecb) {
        model.sync(options).asCallback(ecb);
      }, cb);
    },
    function(cb) {
      async.eachSeries(self.resourceConfig.examples, function(exampleJson, ecb) {
        var validation = Joi.validate(exampleJson, self.resourceConfig.attributes);
        if (validation.error) return ecb(validation.error);
        self.create({ request: { type: self.resourceConfig.resource } }, validation.value, ecb);
      }, cb);
    }
  ];

  async.series(tasks, callback);
};

SqlStore.prototype._buildModels = function() {
  var self = this;

  var localAttributes = Object.keys(self.resourceConfig.attributes).filter(function(attributeName) {
    var settings = self.resourceConfig.attributes[attributeName]._settings;
    if (!settings) return true;
    return !(settings.__one || settings.__many);
  });
  localAttributes = _.pick(self.resourceConfig.attributes, localAttributes);
  var relations = Object.keys(self.resourceConfig.attributes).filter(function(attributeName) {
    var settings = self.resourceConfig.attributes[attributeName]._settings;
    if (!settings) return false;
    return (settings.__one || settings.__many) && !settings.__as;
  });
  relations = _.pick(self.resourceConfig.attributes, relations);

  var modelAttributes = self._joiSchemaToSequelizeModel(localAttributes, self.resourceConfig.dialect);
  self.baseModel = self.sequelize.define(self.resourceConfig.resource, modelAttributes, { timestamps: false });

  self.relations = { };
  self.relationArray = [ ];
  Object.keys(relations).forEach(function(relationName) {
    var relation = relations[relationName];
    var otherModel = self._defineRelationModel(relationName, relation._settings.__many);
    self.relations[relationName] = otherModel;
    self.relationArray.push(otherModel);
  });
};

SqlStore.prototype._joiSchemaToSequelizeModel = function(joiSchema, dialect) {
  var model = {
    id: { type: new DataTypes.STRING(38), primaryKey: true },
    type: DataTypes.STRING,
    meta: {
      type: DataTypes.STRING,
      get: function() {
        var data = this.getDataValue("meta");
        if (!data) return undefined;
        return JSON.parse(data);
      },
      set: function(val) {
        return this.setDataValue("meta", JSON.stringify(val));
      }
    }
  };

  Object.keys(joiSchema).forEach(function(attributeName) {
    var attribute = joiSchema[attributeName];
    if (attribute._type === "string") model[attributeName] = { type: DataTypes.STRING, allowNull: true };
    if (attribute._type === "date") model[attributeName] = { type: DataTypes.STRING, allowNull: true };
    if (attribute._type === "number") model[attributeName] = { type: DataTypes.INTEGER, allowNull: true };
    if (attribute._type === "boolean") model[attributeName] = { type: DataTypes.BOOLEAN, allowNull: true };
    if (attribute._type === "array") {
      if (dialect === "postgres") {
        switch (attribute._type.inner.items[0]._type) {
          case "string": model[attribute] = {type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true}; break;
          case "number": model[attribute] = {type: DataTypes.ARRAY(DataTypes.NUMERIC), allowNull: true}; break;
          case "boolean": model[attribute] = {type: DataTypes.ARRAY(DataTypes.BOOLEAN), allowNull: true}; break;
        }
      } else {
        model[attributeName] = {
          type: DataTypes.STRING,
          allowNull: true,
          get: function () {
            var data = this.getDataValue(attributeName);
            return data ? data.split(';') : []
          },
          set: function (val) {
            this.setDataValue(attributeName, val.join(';'));
          }
        }
      }

    }
  });

  return model;
};

SqlStore.prototype._defineRelationModel = function(relationName, many) {
  var self = this;

  var modelName = self.resourceConfig.resource + "-" + relationName;
  var modelProperties = {
    uid: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    id: {
      type: new DataTypes.STRING(38),
      allowNull: false
    },
    type: {
      type: new DataTypes.STRING(38),
      allowNull: false
    },
    meta: {
      type: DataTypes.STRING,
      get: function() {
        var data = this.getDataValue("meta");
        if (!data) return undefined;
        return JSON.parse(data);
      },
      set: function(val) {
        return this.setDataValue("meta", JSON.stringify(val));
      }
    }
  };

  var relatedModel = self.sequelize.define(modelName, modelProperties, {
    timestamps: false,
    indexes: [ { fields: [ "id" ] } ],
    freezeTableName: true
  });

  if (many) {
    self.baseModel.hasMany(relatedModel, { onDelete: "CASCADE", foreignKey: self.resourceConfig.resource + "Id" });
  } else {
    self.baseModel.hasOne(relatedModel, { onDelete: "CASCADE", foreignKey: self.resourceConfig.resource + "Id" });
  }

  return relatedModel;
};

SqlStore.prototype._fixObject = function(json) {
  var self = this;
  var resourceId = self.resourceConfig.resource + "Id";

  Object.keys(json).forEach(function(attribute) {
    if (attribute.indexOf(self.resourceConfig.resource + "-") !== 0) return;

    var fixedName = attribute.split(self.resourceConfig.resource + "-").pop();
    json[fixedName] = json[attribute];

    var val = json[attribute];
    delete json[attribute];
    if (!val) return;

    if (!(val instanceof Array)) val = [ val ];
    val.forEach(function(j) {
      if (j.uid) delete j.uid;
      if (j[resourceId]) delete j[resourceId];
    });
  });

  return json;
};

SqlStore.prototype._errorHandler = function(e, callback) {
  // console.log(e, e.stack);
  if (e.message.match(/^ER_LOCK_DEADLOCK/)) {
    return callback({
      status: "500",
      code: "EMODIFIED",
      title: "Resource Just Changed",
      detail: "The resource you tried to mutate was modified by another request. Your request has been aborted."
    });
  }

  return callback({
    status: "500",
    code: "EUNKNOWN",
    title: "An unknown error has occured",
    detail: "Something broke when connecting to the database - " + e.message
  });
};

SqlStore.prototype._generateSearchIncludes = function(relationships) {
  var self = this;
  if (!relationships) {
    return {
      count: [],
      findAll: Object.keys(self.relations).map(function(key) {
        return self.relations[key];
      })
    }
  }
  var searchIncludes = Object.keys(self.relations).reduce(function(partialSearchIncludes, relationName) {
    var model = self.relations[relationName];
    partialSearchIncludes.findAll.push(model);

    var matchingValue = relationships[relationName];
    if (!matchingValue) return partialSearchIncludes;
    if (typeof matchingValue === 'string') {
      matchingValue = matchingValue.split(',')
    }
    if (matchingValue instanceof Array) {
      matchingValue = matchingValue.filter(function(i) {
        return !(i instanceof Object);
      });
      if (!matchingValue.length) return partialSearchIncludes;
    } else if (matchingValue instanceof Object) {
      return partialSearchIncludes;
    }
    var includeClause = {
      model: model,
      where: { id: matchingValue }
    };
    partialSearchIncludes.count.push(includeClause);
    // replace simple model with clause
    partialSearchIncludes.findAll.pop();
    partialSearchIncludes.findAll.push(includeClause);
    return partialSearchIncludes;
  }, {
    count: [],
    findAll: []
  });

  return searchIncludes;
};

SqlStore.prototype._generateSearchBlock = function(request) {
  var self = this;

  var attributesToFilter = _.omit(request.processedFilter, Object.keys(self.relations));
  var searchBlock = self._getSearchBlock(attributesToFilter);
  return searchBlock;
};

SqlStore.prototype._scalarFilterElementToWhereObj = function(element) {
  var self = this;

  var value = element.value;
  var op = element.operator;
  if (!op) return value;

  if (op === ">") return { $gt: value };
  if (op === "<") return { $lt: value };

  var iLikeOperator = '$like';
  if (self.sequelize.getDialect() === 'postgres') iLikeOperator = '$iLike';

  if (op === "~") {
    var caseInsensitiveEqualExpression = { };
    caseInsensitiveEqualExpression[iLikeOperator] = value;
    return caseInsensitiveEqualExpression;
  }

  if (op === ":") {
    var caseInsensitiveContainsExpression = { };
    caseInsensitiveContainsExpression[iLikeOperator] = "%" + value + "%";
    return caseInsensitiveContainsExpression;
  }
};

SqlStore.prototype._filterElementToSearchBlock = function(filterElement) {
  var self = this;

  if (!filterElement) return { };
  var whereObjs = filterElement.map(function(scalarFilterElement) {
    return self._scalarFilterElementToWhereObj(scalarFilterElement);
  });
  if (!whereObjs.length) return { };
  if (filterElement.length === 1) {
    return whereObjs[0];
  }
  return { $or: whereObjs };
};

SqlStore.prototype._getSearchBlock = function(filter) {
  var self = this;

  if (!filter) return { };
  var searchBlock = { };

  Object.keys(filter).forEach(function(attributeName) {
    var filterElement = filter[attributeName];
    searchBlock[attributeName] = self._filterElementToSearchBlock(filterElement);
  });

  return searchBlock;
};

SqlStore.prototype._dealWithTransaction = function(done, callback) {
  var self = this;
  var transactionOptions = {
    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    autocommit: false
  };
  self.sequelize.transaction(transactionOptions).asCallback(function(err1, transaction) {
    if (err1) return done(err1);

    var t = { transaction: transaction };
    var commit = function() {
      var args = arguments;
      transaction.commit().asCallback(function(err2) {
        if (err2) return done(err2);
        return done.apply(null, Array.prototype.slice.call(args));
      });
    };
    var rollback = function(e) {
      debug("Err", transaction.name, e);
      var a = function() {
        if (e instanceof Error) return self._errorHandler(e, done);
        return done(e);
      };
      transaction.rollback().then(a, a);
    };
    var finishTransaction = function(err) {
      if (err) return rollback(err);
      return commit.apply(null, Array.prototype.slice.call(arguments));
    };

    return callback(t, finishTransaction);
  });
};

SqlStore.prototype._clearAndSetMany = function(relationModel, prop, theResource, keyName, ucKeyName, t, taskCallback) {
  var whereClause = { };
  whereClause[theResource.type + "Id"] = theResource.id;
  relationModel.destroy({
    where: whereClause,
    transaction: t.transaction
  }).asCallback(function(deleteError) {
    if (deleteError) return taskCallback(deleteError);

    async.map(prop, function(item, acallback) {
      relationModel.create(item, t).asCallback(function(err, newRelationModel) {
        if (err) return acallback(err);

        theResource["add" + ucKeyName](newRelationModel, t).asCallback(acallback);
      });
    }, taskCallback);
  });
};

SqlStore.prototype._clearAndSetOne = function(relationModel, prop, theResource, keyName, ucKeyName, t, taskCallback) {
  var whereClause = { };
  whereClause[theResource.type + "Id"] = theResource.id;
  relationModel.destroy({
    where: whereClause,
    transaction: t.transaction
  }).asCallback(function(deleteError) {
    if (deleteError) return taskCallback(deleteError);
    if (!prop) {
      theResource["set" + ucKeyName](null, t).asCallback(taskCallback);
    } else {
      relationModel.create(prop, t).asCallback(function(err, newRelationModel) {
        if (err) return taskCallback(err);

        theResource["set" + ucKeyName](newRelationModel, t).asCallback(taskCallback);
      });
    }
  });
};

SqlStore.prototype._clearAndSetRelationTables = function(theResource, partialResource, t, callback) {
  var self = this;

  var tasks = { };
  Object.keys(self.relations).forEach(function(relationName) {
    var prop = partialResource[relationName];
    if (!partialResource.hasOwnProperty(relationName)) return;
    var relationModel = self.relations[relationName];

    var keyName = self.resourceConfig.resource + "-" + relationName;
    var ucKeyName = keyName[0].toUpperCase() + keyName.slice(1, keyName.length);

    tasks[relationName] = function(taskCallback) {
      if (prop instanceof Array) {
        self._clearAndSetMany(relationModel, prop, theResource, keyName, ucKeyName, t, taskCallback);
      } else {
        self._clearAndSetOne(relationModel, prop, theResource, keyName, ucKeyName, t, taskCallback);
      }
    };
  });

  async.parallel(tasks, callback);
};

SqlStore.prototype._generateSearchOrdering = function(request) {
  if (!request.params.sort) return undefined;

  var attribute = request.params.sort;
  var order = "ASC";
  attribute = String(attribute);
  if (attribute[0] === "-") {
    order = "DESC";
    attribute = attribute.substring(1, attribute.length);
  }
  return [ [ attribute, order ] ];
};

SqlStore.prototype._generateSearchPagination = function(request) {
  var page = request.params.page;
  if (!page) return undefined;

  return {
    limit: page.limit,
    offset: page.offset
  };
};

/**
  Search for a list of resources, given a resource type.
 */
SqlStore.prototype.search = function(request, callback) {
  var self = this;

  var options = { };
  var where = self._generateSearchBlock(request);
  if (where) {
    options.where = where;
  }
  var includeBlocks = self._generateSearchIncludes(request.params.filter);
  debug("includeBlocks", util.inspect(includeBlocks, { depth: null }))
  if (includeBlocks.count.length) {
    options.include = includeBlocks.count;
  }
  self.baseModel.count(options).asCallback(function(err, count) {
    debug("Count", count);
    if (includeBlocks.findAll.length) {
      options.include = includeBlocks.findAll;
    }
    var order = self._generateSearchOrdering(request);
    if (order) {
      options.order = order;
    }
    var pagination = self._generateSearchPagination(request);
    if (pagination) {
      if (pagination.offset > 0 || pagination.limit <= count) {
        _.assign(options, pagination);
      }
    }
    self.baseModel.findAll(options).asCallback(function(err, result) {
      debug(options, err, JSON.stringify(result));
      if (err) return self._errorHandler(err, callback);
      var records = result.map(function(i){ return self._fixObject(i.toJSON()); });
      debug("Produced", JSON.stringify(records));
      return callback(null, records, count);
    });
  });
};

/**
  Find a specific resource, given a resource type and and id.
 */
SqlStore.prototype.find = function(request, callback) {
  var self = this;

  self.baseModel.findOne({
    where: { id: request.params.id },
    include: self.relationArray
  }).asCallback(function(err, theResource) {
    if (err) return self._errorHandler(err, callback);

    // If the resource doesn't exist, error
    if (!theResource) {
      return callback({
        status: "404",
        code: "ENOTFOUND",
        title: "Requested resource does not exist",
        detail: "There is no " + request.params.type + " with id " + request.params.id
      });
    }

    theResource = self._fixObject(theResource.toJSON());
    debug("Produced", JSON.stringify(theResource));
    return callback(null, theResource);
  });
};

/**
  Create (store) a new resource give a resource type and an object.
 */
SqlStore.prototype.create = function(request, newResource, finishedCallback) {
  var self = this;

  self._dealWithTransaction(finishedCallback, function(t, finishTransaction) {

    self.baseModel.create(newResource, t).asCallback(function(err2, theResource) {
      if (err2) return finishTransaction(err2);

      self._clearAndSetRelationTables(theResource, newResource, t, function(err){
        if (err) return finishTransaction(err);

        return finishTransaction(null, newResource);
      });
    });
  });
};

/**
  Delete a resource, given a resource type and and id.
 */
SqlStore.prototype.delete = function(request, finishedCallback) {
  var self = this;

  self._dealWithTransaction(finishedCallback, function(t, finishTransaction) {
    self.baseModel.findAll({
      where: { id: request.params.id },
      include: self.relationArray
    }).asCallback(function(findErr, results) {
      if (findErr) return finishTransaction(findErr);

      var theResource = results[0];

      // If the resource doesn't exist, error
      if (!theResource) {
        return finishTransaction({
          status: "404",
          code: "ENOTFOUND",
          title: "Requested resource does not exist",
          detail: "There is no " + request.params.type + " with id " + request.params.id
        });
      }

      theResource.destroy(t).asCallback(function(deleteErr) {
        return finishTransaction(deleteErr);
      });
    });
  });
};

/**
  Update a resource, given a resource type and id, along with a partialResource.
  partialResource contains a subset of changes that need to be merged over the original.
 */
SqlStore.prototype.update = function(request, partialResource, finishedCallback) {
  var self = this;

  self._dealWithTransaction(finishedCallback, function(t, finishTransaction) {

    self.baseModel.findOne({
      where: { id: request.params.id },
      include: self.relationArray,
      transaction: t.transaction
    }).asCallback(function(err2, theResource) {
      if (err2) return finishTransaction(err2);

      // If the resource doesn't exist, error
      if (!theResource) {
        return finishTransaction({
          status: "404",
          code: "ENOTFOUND",
          title: "Requested resource does not exist",
          detail: "There is no " + request.params.type + " with id " + request.params.id
        });
      }

      self._clearAndSetRelationTables(theResource, partialResource, t, function(err){
        if (err) return finishTransaction(err);

        theResource.update(partialResource, t).asCallback(function(err3) {
          if (err) return finishTransaction(err3);
          return finishTransaction(null, partialResource);
        });
      });
    });
  });
};
