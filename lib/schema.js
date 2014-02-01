var AbstractClass = require('./model.js');
var List = require('./list.js');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

exports.Schema = Schema;
Schema.Text = function Text(s) { return s; };
Schema.JSON = function JSON() {};
Schema.types = {};
Schema.registerType = function (type) {
	this.types[type.name] = type;
};
Schema.registerType(Schema.Text);
Schema.registerType(Schema.JSON);

function hiddenProperty(where, property, value) {
	Object.defineProperty(where, property, {
		writable: false,
		enumerable: false,
		configurable: false,
		value: value
	});
}
function defineReadonlyProp(obj, key, value) {
	Object.defineProperty(obj, key, {
		writable: false,
		enumerable: true,
		configurable: true,
		value: value
	});
}
function standartize(properties) {
	Object.keys(properties).forEach(function (key) {
		var v = properties[key];
		if (typeof v === 'function' || typeof v === 'object' && v && v.constructor.name === 'Array') {
			properties[key] = { type: v };
		}
	});
}

function Schema(name, settings) {
	var schema = this;
	this.name = name;
	this.settings = settings || {};
	this.models = {};
	this.definitions = {};
	if (this.settings.log) {
		this.on('log', function(str, duration) {
			console.log(str);
		});
	}
	this.connected = false;
	this.connecting = true;
	var adapter = require('./adapters/' + name);
	adapter.initialize(this, function () {
		this.connected = true;
		this.connecting = false;
		this.emit('connected');
	}.bind(this));
};
util.inherits(Schema, EventEmitter);

Schema.prototype.connect = function (cb) {
	var schema = this;
	schema.connecting = true;
	if (schema.adapter.connect) {
		schema.adapter.connect(function(err) {
			if (!err) {
				schema.connected = true;
				schema.connecting = false;
				schema.emit('connected');
			}
			if (cb) cb(err);
		});
	} else {
		if (cb) process.nextTick(cb);
	}
};

Schema.prototype.define = function defineClass(className, properties, settings) {
	var schema = this;
	var args = Array.prototype.slice.call(arguments);
	if (args.length == 1) properties = {}, args.push(properties);
	if (args.length == 2) settings   = {}, args.push(settings);
	settings = settings || {};
	properties = properties || {};
	var NewClass = function ModelConstructor(data, schema) {
		if (!(this instanceof ModelConstructor)) {
			return new ModelConstructor(data);
		}
		AbstractClass.call(this, data);
		hiddenProperty(this, 'schema', schema || this.constructor.schema);
	};
	hiddenProperty(NewClass, 'schema', schema);
	hiddenProperty(NewClass, 'settings', settings);
	hiddenProperty(NewClass, 'properties', properties);
	hiddenProperty(NewClass, 'modelName', className);
	hiddenProperty(NewClass, 'tableName', settings.table || className);
	hiddenProperty(NewClass, 'relations', {});
	for (var i in AbstractClass) {
		NewClass[i] = AbstractClass[i];
	}
	for (var j in AbstractClass.prototype) {
		NewClass.prototype[j] = AbstractClass.prototype[j];
	}
	NewClass.getter = {};
	NewClass.setter = {};
	standartize(properties);
	this.models[className] = NewClass;
	this.definitions[className] = {
		properties: properties,
		settings: settings
	};
	this.adapter.define({
		model:		NewClass,
		properties:	properties,
		settings:	settings
	});
	NewClass.prototype.__defineGetter__('id', function () {
		return this.__data.id;
	});
	properties.id = properties.id || { type: schema.settings.slave ? String : Number };
	NewClass.forEachProperty = function (cb) {
		Object.keys(properties).forEach(cb);
	};
	NewClass.registerProperty = function (attr) {
		var DataType = properties[attr].type;
		if (DataType instanceof Array) {
			DataType = List;
		} else if (DataType.name === 'Date') {
			var OrigDate = Date;
			DataType = function Date(arg) {
				return new OrigDate(arg);
			};
		} else if (DataType.name === 'JSON' || DataType === JSON) {
			DataType = function JSON(s) {
				return s;
			};
		} else if (DataType.name === 'Text' || DataType === Schema.Text) {
			DataType = function Text(s) {
				return s;
			};
		}
		Object.defineProperty(NewClass.prototype, attr, {
			get: function () {
				if (NewClass.getter[attr]) {
					return NewClass.getter[attr].call(this);
				} else {
					return this.__data[attr];
				}
			},
			set: function (value) {
				if (NewClass.setter[attr]) {
					NewClass.setter[attr].call(this, value);
				} else {
					if (value === null || value === undefined || typeof DataType === 'object') {
						this.__data[attr] = value;
					} else if (DataType === Boolean) {
						this.__data[attr] = value === 'false' ? false : !!value;
					} else {
						this.__data[attr] = DataType(value);
					}
				}
			},
			configurable: true,
			enumerable: true
		});
		NewClass.prototype.__defineGetter__(attr + '_was', function () {
			return this.__dataWas[attr];
		});
		Object.defineProperty(NewClass.prototype, '_' + attr, {
			get: function () {
				return this.__data[attr];
			},
			set: function (value) {
				this.__data[attr] = value;
			},
			configurable: true,
			enumerable: false
		});
	};
	NewClass.forEachProperty(NewClass.registerProperty);
	this.emit('define', NewClass, className, properties, settings);
	return NewClass;
};

Schema.prototype.defineProperty = function (model, prop, params) {
	this.definitions[model].properties[prop] = params;
	this.models[model].registerProperty(prop);
	if (this.adapter.defineProperty) {
		this.adapter.defineProperty(model, prop, params);
	}
};

Schema.prototype.extendModel = function (model, props) {
	var t = this;
	standartize(props);
	Object.keys(props).forEach(function (propName) {
		var definition = props[propName];
		t.defineProperty(model, propName, definition);
	});
};

Schema.prototype.automigrate = function (cb) {
	this.freeze();
	if (this.adapter.automigrate) {
		this.adapter.automigrate(cb);
	} else if (cb) {
		cb();
	}
};

Schema.prototype.autoupdate = function (cb) {
	this.freeze();
	if (this.adapter.autoupdate) {
		this.adapter.autoupdate(cb);
	} else if (cb) {
		cb();
	}
};

Schema.prototype.isActual = function (cb) {
	this.freeze();
	if (this.adapter.isActual) {
		this.adapter.isActual(cb);
	} else if (cb) {
		cb(null, true);
	}
};

Schema.prototype.log = function (sql, t) {
	this.emit('log', sql, t);
};

Schema.prototype.freeze = function freeze() {
	if (this.adapter.freezeSchema) {
		this.adapter.freezeSchema();
	}
}

Schema.prototype.tableName = function (modelName) {
	return this.models[modelName].model.tableName;
};

Schema.prototype.disconnect = function disconnect(cb) {
	if (typeof this.adapter.disconnect === 'function') {
		this.connected = false;
		this.adapter.disconnect(cb);
	} else if (cb) {
		cb();
	}
};
