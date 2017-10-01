var DataTypes = require('sequelize').DataTypes

exports.joiSchemaToSequelizeModel = function(resourceName, joiSchema) {
  var model = {
    id: { type: new DataTypes.STRING(38), primaryKey: true },
    type: {
      type: DataTypes.VIRTUAL, //We do not actually save this to DB, but API needs this
      set: function (val) {
        this.setDataValue('type', val)
      },
      get: function () {
        return resourceName
      }
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

  Object.keys(joiSchema).forEach(function(attributeName) {
    var attribute = joiSchema[attributeName];
    if (attribute._type === "string") model[attributeName] = { type: DataTypes.TEXT, allowNull: true };
    if (attribute._type === "date") model[attributeName] = { type: DataTypes.DATE, allowNull: true };
    if (attribute._type === "number") model[attributeName] = { type: DataTypes.NUMERIC, allowNull: true };
    if (attribute._type === "boolean") model[attributeName] = { type: DataTypes.BOOLEAN, allowNull: true };
    if (attribute._type === "array") {
      //Serialize array to ';'-separated string for most SQL dbs.
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
  });

  return model;
};
