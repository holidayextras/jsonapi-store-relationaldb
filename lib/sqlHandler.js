"use strict";
// http://docs.sequelizejs.com/en/latest/
var Sequelize = require("sequelize");
var async = require("async");
var crypto = require("crypto");
var debug = require("debug")("jsonApi:store:relationaldb");
var _ = {
  pick: require("lodash.pick"),
  assign: require("lodash.assign"),
  omit: require("lodash.omit")
};

var SqlStore = module.exports = function SqlStore(config) {
  this.config = config;
};

SqlStore._sequelizeInstances = Object.create(null);

/**
  Handlers readiness status. This should be set to `true` once all handlers are ready to process requests.
 */
SqlStore.prototype.ready = false;

/**
  initialise gets invoked once for each resource that uses this hander.
  In this instance, we're instantiating a Sequelize instance and building models.
 */
SqlStore.prototype.initialise = function(resourceConfig) {
  var self = this;
  self.resourceConfig = resourceConfig;

  var sequelizeArgs = [self.config.database || resourceConfig.resource, self.config.username, self.config.password, {
    dialect: self.config.dialect,
    host: self.config.host,
    port: self.config.port,
    logging: self.config.logging || require("debug")("jsonApi:store:relationaldb:sequelize"),
    freezeTableName: true
  }];

  // To prevent too many open connections, we will store all Sequelize instances in a hash map.
  // Index the hash map by a hash of the entire config object. If the same config is passed again,
  // reuse the existing Sequelize connection resource instead of opening a new one.

  var md5sum = crypto.createHash('md5');
  var instanceId = md5sum.update(JSON.stringify(sequelizeArgs)).digest('hex');

  if (!SqlStore._sequelizeInstances[instanceId]) {
    var bindArgs = [Sequelize].concat(sequelizeArgs);
    SqlStore._sequelizeInstances[instanceId] = {
      instance: new (Function.prototype.bind.apply(Sequelize, bindArgs)),
      synced: false
    };
  }

  self.sequelizeInstanceInfo = SqlStore._sequelizeInstances[instanceId];
  self.sequelize = self.sequelizeInstanceInfo.instance;

  self._buildModels();

  self.ready = true;
};

SqlStore.prototype.populate = function(callback) {
  var self = this;

  // `sync` should only be called once per instance of Sequelize, but example data should be
  // populated for each resource.
  function onSynced(err) {
    if (err) return callback (err);

    self.sequelizeInstanceInfo.synced = true;
    async.map(self.resourceConfig.examples, function(exampleJson, asyncCallback) {
      self.create({ request: { type: self.resourceConfig.resource } }, exampleJson, asyncCallback);
    }, callback);
  }

  if (!self.sequelizeInstanceInfo.synced) {
    self.sequelize.sync({ force: true }).asCallback(onSynced);
  } else {
    onSynced();
  }
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

  var modelAttributes = self._joiSchemaToSequelizeModel(localAttributes);
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

SqlStore.prototype._joiSchemaToSequelizeModel = function(joiSchema) {
  var model = {
    id: { type: new Sequelize.STRING(38), primaryKey: true },
    type: Sequelize.STRING,
    meta: {
      type: Sequelize.STRING,
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
    if (attribute._type === "string") model[attributeName] = { type: Sequelize.STRING, allowNull: true };
    if (attribute._type === "date") model[attributeName] = { type: Sequelize.STRING, allowNull: true };
    if (attribute._type === "number") model[attributeName] = { type: Sequelize.INTEGER, allowNull: true };
  });

  return model;
};

SqlStore.prototype._defineRelationModel = function(relationName, many) {
  var self = this;

  var modelName = self.resourceConfig.resource + "-" + relationName;
  var modelProperties = {
    uid: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    id: {
      type: new Sequelize.STRING(38),
      allowNull: false
    },
    type: {
      type: new Sequelize.STRING(38),
      allowNull: false
    },
    meta: {
      type: Sequelize.STRING,
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
  return callback({
    status: "500",
    code: "EUNKNOWN",
    title: "An unknown error has occured",
    detail: "Something broke when connecting to the database - " + e.message
  });
};

SqlStore.prototype._filterInclude = function(relationships) {
  var self = this;
  relationships = _.pick(relationships, Object.keys(self.relations));

  var includeBlock = Object.keys(self.relations).map(function(relationName) {
    var model = self.relations[relationName];
    var matchingValue = relationships[relationName];
    if (!matchingValue) return model;

    if (matchingValue instanceof Array) {
      matchingValue = matchingValue.filter(function(i) {
        return !(i instanceof Object);
      });
    } else if (matchingValue instanceof Object) {
      return model;
    }

    return {
      model: model,
      where: { id: matchingValue }
    };
  });

  return includeBlock;
};

SqlStore.prototype._generateSearchBlock = function(request) {
  var self = this;

  var attributesToFilter = _.omit(request.params.filter, Object.keys(self.relations));
  var searchBlock = self._recurseOverSearchBlock(attributesToFilter);
  return searchBlock;
};

SqlStore.prototype._recurseOverSearchBlock = function(obj) {
  var self = this;
  if (!obj) return { };
  var searchBlock = { };

  Object.keys(obj).forEach(function(attributeName) {
    var textToMatch = obj[attributeName];
    if (textToMatch instanceof Array) {
      searchBlock[attributeName] = { $or: textToMatch.map(function(i) {
        return self._recurseOverSearchBlock({ i: i }).i;
      }) };
    } else if (textToMatch instanceof Object) {
      // Do nothing, its a nested filter
    } else if (textToMatch[0] === ">") {
      searchBlock[attributeName] = { $gt: textToMatch.substring(1) };
    } else if (textToMatch[0] === "<") {
      searchBlock[attributeName] = { $lt: textToMatch.substring(1) };
    } else if (textToMatch[0] === "~") {
      searchBlock[attributeName] = { $like: textToMatch.substring(1) };
    } else if (textToMatch[0] === ":") {
      searchBlock[attributeName] = { $like: "%" + textToMatch.substring(1) + "%" };
    } else {
      searchBlock[attributeName] = textToMatch;
    }
  });

  return searchBlock;
};

SqlStore.prototype._dealWithTransaction = function(done, callback) {
  var self = this;
  var transactionOptions = {
    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_UNCOMMITTED,
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
      debug("Err", e);
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

SqlStore.prototype._clearAndSetRelationTables = function(theResource, partialResource, t, callback) {
  var self = this;

  var tasks = { };
  Object.keys(self.relations).forEach(function(relationName) {
    var prop = partialResource[relationName];
    if (!partialResource.hasOwnProperty(relationName)) return;
    var relationModel = self.relations[relationName];

    var keyName = self.resourceConfig.resource + "-" + relationName;
    var uc = keyName[0].toUpperCase() + keyName.slice(1, keyName.length);

    tasks[relationName] = function(taskCallback) {
      if (prop instanceof Array) {
        (theResource[keyName] || []).map(function(deadRow) {
          deadRow.destroy(t);
        });

        async.map(prop, function(item, acallback) {
          relationModel.create(item, t).asCallback(function(err4, newRelationModel) {
            if (err4) return acallback(err4);

            theResource["add" + uc](newRelationModel, t).asCallback(acallback);
          });
        }, taskCallback);
      } else {
        if (theResource[keyName]) {
          theResource[keyName].destroy(t);
        }
        if (!prop) {
          theResource["set" + uc](null, t).asCallback(taskCallback);
        } else {
          relationModel.create(prop, t).asCallback(function(err3, newRelationModel) {
            if (err3) return taskCallback(err3);

            theResource["set" + uc](newRelationModel, t).asCallback(taskCallback);
          });
        }
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
  if (!request.params.page) {
    return { };
  }

  return {
    limit: request.params.page.limit,
    offset: request.params.page.offset
  };
};

/**
  Search for a list of resources, given a resource type.
 */
SqlStore.prototype.search = function(request, callback) {
  var self = this;

  var base = {
    where: self._generateSearchBlock(request),
    include: self._filterInclude(request.params.filter),
    order: self._generateSearchOrdering(request)
  };
  var query = _.assign(base, self._generateSearchPagination(request));

  self.baseModel.findAndCount(query).asCallback(function(err, result) {
    debug(query, err, JSON.stringify(result));
    if (err) return self._errorHandler(err, callback);

    var records = result.rows.map(function(i){ return self._fixObject(i.toJSON()); });
    debug("Produced", JSON.stringify(records));
    return callback(null, records, result.count);
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
SqlStore.prototype.delete = function(request, callback) {
  var self = this;

  self.baseModel.findAll({
    where: { id: request.params.id },
    include: self.relationArray
  }).asCallback(function(findErr, results) {
    if (findErr) return self._errorHandler(findErr, callback);

    var theResource = results[0];

    // If the resource doesn't exist, error
    if (!theResource) {
      return callback({
        status: "404",
        code: "ENOTFOUND",
        title: "Requested resource does not exist",
        detail: "There is no " + request.params.type + " with id " + request.params.id
      });
    }

    theResource.destroy().asCallback(function(deleteErr) {
      return callback(deleteErr);
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
