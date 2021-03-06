var ProxyPort = (function () {
    "use strict";

    var root;
    // Special case for web worker root object to avoid Chrome bug.
    if (typeof self !== "undefined") {
        root = self;
    }
    else if (typeof window !== "undefined") {
        root = window;
    }
    else if (typeof global !== "undefined") {
        root = global;
    }
    else {
        throw new Error("Unknown global.");
    }

    // To do:
    // - explicit async new calls
    // - explicit async delete calls
    // - explicit refreshAsync to obtain recent version of object

    // Produce an array containing the contents of an array like object. Should replace with ES6 Array.from
    var toArray = function (arrayLikeObject) {
        var array = [],
            idx;

        for (idx = 0; idx < arrayLikeObject.length; ++idx) {
            if (arrayLikeObject.hasOwnProperty(idx)) {
                array[idx] = arrayLikeObject[idx];
            }
        }

        return array;
    };

    // Return an array of name value pair objects of the properties on an object
    var getObjectProperties = function (object, ownPropertiesOnly) {
        var name,
            value,
            results = [];

        for (name in object) {
            if (!ownPropertiesOnly || object.hasOwnProperty(name)) {
                try {
                    value = object[name];
                }
                catch (e) {
                    value = e;
                }
                results.push({
                    specificType: specificTypeOf(value),
                    name: name,
                    value: value
                });
            }
        }
        return results;
    };

    // Apply an array of properties to an object.
    var applyObjectProperties = function (object, properties) {
        properties.forEach(function (property) {
            object[property.name] = property.value;
        });
        return object;
    };

    var arrayConstructor = [].constructor;
    var specificTypeOf = function (object) {
        var type = typeof object;
        if (object === null) {
            type = "null";
        }
        if (object && object.constructor && object.constructor === arrayConstructor) {
            type = "array";
        }
        return type;
    }

    // Helper class for dispatching events.
    var EventTarget = function (target, eventTypes) {
        var eventTypeToHandlers = {}; // Map from event type name string to array of event handlers.

        if (!(this instanceof EventTarget)) {
            throw new Error("EventTarget is a constructor and must be called with new.");
        }

        function validateEventType(eventType) {
            if (!eventTypes.some(function (comparisonEventType) { return eventType === comparisonEventType; })) {
                throw new Error("Event type " + eventType + " not supported. Must be one of " + eventTypes.join(", "));
            }
        }

        function addEventListener(eventType, eventHandler) {
            console.assert(typeof eventHandler === "function");
            validateEventType(eventType);
            if (!eventTypeToHandlers.hasOwnProperty(eventType)) {
                eventTypeToHandlers[eventType] = [];
            }
            eventTypeToHandlers[eventType].push(eventHandler);
        }

        function removeEventListener(eventType, eventHandler) {
            validateEventType(eventType);
            console.assert(eventTypeToHandlers.hasOwnProperty(eventType));
            if (eventTypeToHandlers.hasOwnProperty(eventType)) {
                eventTypeToHandlers[eventType] = eventTypeToHandlers[eventType].filter(function (comparisonEventHandler) {
                    return comparisonEventHandler !== eventHandler;
                });
            }
        }

        function dispatchEvent(eventType, eventArg) {
            validateEventType(eventType);
            if (eventTypeToHandlers.hasOwnProperty(eventType)) {
                eventTypeToHandlers[eventType].filter(function (eventHandler) { return eventHandler; }).forEach(function (eventHandler) {
                    eventHandler.call(null, eventArg);
                });
            }
            if (target["on" + eventType]) {
                target["on" + eventType].call(null, eventArg);
            }
        }
        this.dispatchEvent = dispatchEvent.bind(this);

        target.addEventListener = addEventListener.bind(this);
        target.removeEventListener = removeEventListener.bind(this);
        eventTypes.forEach(function (eventType) {
            if (!target.hasOwnProperty("on" + eventType)) {
                target["on" + eventType] = null;
            }
        });

        eventTypes.map(function (eventType) {
            return {
                name: "dispatch" + eventType[0].toUpperCase() + eventType.substr(1) + "Event",
                fn: dispatchEvent.bind(this, eventType)
            };
        }.bind(this)).forEach(function (dispatchEntry) {
            this[dispatchEntry.name] = dispatchEntry.fn;
        }.bind(this));
    };

    // ID related functionality specific to ProxyPort
    var Id = (function () {
        var Id = {};
        var unique = 0;
        var uniqueValue = function () {
            return unique++;
        }
        var generateRandomHexDigits = function (digits) {
            var value = Math.floor(Math.random() * Math.pow(16, digits));
            value = value.toString(16);
            while (value.length < digits) {
                value = "0" + value;
            }
            return value;
        }
        Id.createProxyPortId = function () {
            var idx, values = [];
            for (idx = 0; idx < 4; ++idx) {
                values.push(generateRandomHexDigits(4));
            }
            return "p" + values.join("");
        }
        Id.createObjectId = function () {
            return "o" + uniqueValue();
        }
        Id.createCallId = function () {
            return "c" + uniqueValue();
        }
        Id.createGroupId = function(proxyPortId) {
            return proxyPortId + ".g" + uniqueValue();
        }
        Id.proxyPortMessageType = "tag:deletethis.net,2014:ProxyPort.Message.v1";
        Id.proxyServerMessageType = "tag:deletethis.net,2014:ProxyServer.Message.v1";
        Id.messageIds = (function () {
            var names = ["postObject", "callFunction", "callFunctionResolved", "disconnect", "addReference", "removeReference", "serverPortInitialize", "serverReady", "serverInitialize", "serverConnected"],
                ids = {};
            return names.reduce(function (total, name) { total[name] = name; return total; }, {});
        })();
        Id.anyProxyPortId = "p*";

        return Id;
    })();

    // Subset of JsonReference used by ProxyPort. Only child relative references starting at a root are allowed.
    var JsonReference = (function () {
        var JsonReference = {};
        var resolveArray = function (names, root) {
            return names.reduce(function (current, next) { return current[next]; }, root);
        }
        JsonReference.fromArray = function (names) {
            return ["$"].concat(names).join(".");
        }
        JsonReference.toArray = function (jsonReference) {
            return jsonReference.split(".").slice(1);
        }
        JsonReference.resolve = function (jsonReference, root) {
            return resolveArray(JsonReference.toArray(jsonReference), root);
        }
        JsonReference.resolveParent = function (jsonReference, root) {
            var names = JsonReference.toArray(jsonReference);
            return {
                parent: resolveArray(names.slice(0, names.length - 1), root),
                childName: names[names.length - 1]
            };
        }
        return JsonReference;
    })();

    // Promise implementation normalizer. I need wrap and defer which is not standardized by promises/A+
    var PromiseUtil = (function () {
        var Promise = {
                wrap: null,
                wrapError: null,
                defer: null
            };

        if (typeof Q !== "undefined") {
            Promise.defer = function () {
                var deferral = Q.defer();
                deferral.addEventListener = deferral.removeEventListener = function () { };
                return deferral;
            };
            Promise.wrap = Q;
            Promise.wrapError = Q.reject
        }
        else if (typeof WinJS !== "undefined") {
            Promise.defer = function () {
                var resolve,
                    reject,
                    notify,
                    eventTarget,
                    promise = new WinJS.Promise(function (resolveIn, rejectIn, notifyIn) {
                        resolve = resolveIn;
                        reject = rejectIn;
                        notify = notifyIn;
                    }, function onCancel() { eventTarget.dispatchCancelledEvent(); }),
                    deferral = {
                        promise: promise,
                        resolve: resolve,
                        reject: reject,
                        notify: notify
                    };

                eventTarget = new EventTarget(deferral, ["cancelled"]);
                return deferral;
            }
            Promise.wrap = WinJS.Promise.wrap;
            Promise.wrapError = WinJS.Promise.wrapError;
        }
        else if (typeof require !== "undefined") {
            Q = require("./q");
            Promise.defer = function () {
                var deferral = Q.defer();
                deferral.addEventListener = deferral.removeEventListener = function () { };
                return deferral;
            };
            Promise.wrap = Q;
            Promise.wrapError = Q.reject
        }
        else {
            throw new Error("No promise implementation found. Please include Q or WinJS.");
        }

        PromiseUtil = function () { return Promise; }
        return Promise;
    });

    // ProxyPort specific functionality for serializing and deserializing an object.
    // Handles cycles, functions, unproxying, and undefined. The result is JSON serializable
    var ObjectSerializer = (function () {
        var ObjectSerializer = {};
        var typeIsExpandable = function (type) {
            var expandable = false;
            switch (type) {
                case "array":
                case "object":
                case "function":
                    expandable = true;
                    break;
            }
            return expandable;
        }
        var buildSerializedObject = function (fromObject, serializedObject, names, depth, foundReferences, tryGetProxyInfo) {
            var toObject = fromObject,
                fromObjectSpecificType = specificTypeOf(fromObject),
                foundReference,
                proxyInfo;

            if (typeIsExpandable(fromObjectSpecificType)) {
                foundReference = foundReferences.get(fromObject);

                if (!foundReference) {
                    foundReferences.set(fromObject, JsonReference.fromArray(names));

                    toObject = fromObjectSpecificType === "array" ? [] : {};

                    if (fromObjectSpecificType === "function") {
                        serializedObject.functionFixups.push(JsonReference.fromArray(names));
                    }

                    if (depth > 1) {
                        applyObjectProperties(toObject, getObjectProperties(fromObject).filter(function (property) { return property.name !== "_getProxyPortInfo"}).map(function (fromProperty) {
                            return {
                                name: fromProperty.name,
                                value: buildSerializedObject(fromProperty.value, serializedObject, names.concat([fromProperty.name]), depth - 1, foundReferences, tryGetProxyInfo)
                            };
                        }));
                    }

                    proxyInfo = tryGetProxyInfo(fromObject);
                    if (proxyInfo) {
                        serializedObject.proxyFixups.push({
                            from: JsonReference.fromArray(names),
                            to: proxyInfo
                        });
                    }
                }
                else {
                    serializedObject.cycleFixups.push({
                        from: JsonReference.fromArray(names),
                        to: foundReference
                    });
                    toObject = undefined;
                }
            }
            else if (fromObject === undefined) {
                serializedObject.undefinedFixups.push({ from: JsonReference.fromArray(names) });
            }

            return toObject;
        }
        ObjectSerializer.serialize = function (object, maximumDepth, tryGetProxyInfo) {
            var serializedObject = {
                data: {},
                cycleFixups: [],
                functionFixups: [],
                proxyFixups: [],
                undefinedFixups: []
            };
            maximumDepth = maximumDepth || Infinity;

            serializedObject.data = buildSerializedObject(object, serializedObject, [], maximumDepth, new Map(), tryGetProxyInfo);
            
            return serializedObject;
        }

        function extensibleObjectReplacer(fromData, names, groupId, extensibleObjectCreator) {
            var fromDataSpecificType = specificTypeOf(fromData),
                toData = fromData;

            if (typeIsExpandable(fromDataSpecificType)) {
                toData = extensibleObjectCreator(JsonReference.fromArray(names), groupId, fromDataSpecificType);
                applyObjectProperties(toData, getObjectProperties(fromData).map(function (property) {
                    return {
                        name: property.name,
                        value: extensibleObjectReplacer(property.value, names.concat([property.name]), groupId, extensibleObjectCreator)
                    };
                }));
            }

            return toData;
        }
        ObjectSerializer.deserialize = function (serializedObject, createProxyFunction, proxyResolver, extensibleObjectCreator, proxyOptions) {
            var data = extensibleObjectReplacer(serializedObject.data, [], proxyOptions.groupId, extensibleObjectCreator);
            // Make it obvious that we're taking ownership of the data property. We perform the fixups in place and don't want the caller trying to use data after this.
            serializedObject.data = null;

            serializedObject.cycleFixups.forEach(function (cycleEntry) {
                var from = JsonReference.resolveParent(cycleEntry.from, data);
                from.parent[from.childName] = JsonReference.resolve(cycleEntry.to, data);
            });

            serializedObject.functionFixups.map(function (jsonReference) {
                return {
                    jsonReference: jsonReference,
                    value: createProxyFunction(serializedObject, jsonReference, proxyOptions)
                }
            }).forEach(function (functionEntry) {
                var oldValue = JsonReference.resolve(functionEntry.jsonReference, data);
                var newValue = functionEntry.value;
                var from = JsonReference.resolveParent(functionEntry.jsonReference, data);
                if (from.childName === undefined) {
                    data = newValue;
                }
                else {
                    from.parent[from.childName] = newValue;
                }
                applyObjectProperties(newValue, getObjectProperties(oldValue));
            });

            serializedObject.undefinedFixups.forEach(function (undEntry) {
                var from = JsonReference.resolveParent(undEntry.from, data);
                if (from.childName === undefined) {
                    data = undefined;
                }
                else {
                    from.parent[from.childName] = undefined;
                }
            });

            // {from: $JsonPath, to: {proxyPortId: $ProxyPortId, objectId: $ObjectId} }
            serializedObject.proxyFixups.map(function (proxyEntry) {
                var unproxyObject = proxyResolver(proxyEntry.to),
                    toRef;
                if (unproxyObject) {
                    toRef = JsonReference.resolveParent(proxyEntry.from, data);
                    if (toRef.childName === undefined) {
                        data = unproxyObject;
                    }
                    else {
                        toRef.parent[toRef.childName] = unproxyObject;
                    }
                }
            });

            return data;
        }
        return ObjectSerializer;
    })();

    function ProxyPort(port, proxyPortOptions) {
        var eventTarget = new EventTarget(this, ["object", "objectRemoved"]),
            proxyPortId = Id.createProxyPortId(),
            callIdToDeferral = {},
            callIdToCancellable = {},
            objectIdToObject,
            getObjectIdToObject = function () {
                if (!objectIdToObject) {
                    objectIdToObject = new ReferenceCountedMap();
                }
                return objectIdToObject;
            },
            groupIdToProxies = {},
            self = this;

        var ReferenceCountedMap = function () {
            var map = new Map(),
                self = this;

            if (!this instanceof ReferenceCountedMap) {
                throw new TypeError("ReferenceCountedMap is a constructor and must be called with new.");
            }

            this.clear = function () {
                map.clear();
            }
            this.add = function (key, value) {
                map.set(key, { referenceCount: 1, value: value });
            }
            this.get = function (key) {
                return map.get(key).value;
            }
            this.has = function (key) {
                return map.has(key);
            }
            this.addReference = function (key) {
                map.get(key).referenceCount++;
            }
            this.removeReference = function (key) {
                if (--map.get(key).referenceCount == 0) {
                    map.delete(key);
                    eventTarget.dispatchObjectRemovedEvent(key);
                }
            }
        };

        proxyPortOptions = proxyPortOptions || {};

        if (!(this instanceof ProxyPort)) {
            throw new Error("ProxyPort is a constructor and must be called with new.");
        }

        var createOptions = function (proxyPortId, firstOptions, secondOptions) {
            var options = {},
                proxyInfo = null;

            if (firstOptions) {
                applyObjectProperties(options, getObjectProperties(firstOptions));
            }
            if (secondOptions) {
                applyObjectProperties(options, getObjectProperties(secondOptions));
            }
            options.maximumDepth = options.maximumDepth || Infinity;

            if (options.groupId) {
                proxyInfo = tryGetProxyInfo(options.groupId);
                if (proxyInfo) {
                    options.groupId = proxyInfo.groupId;
                }
            }
            else {
                options.groupId = Id.createGroupId(proxyPortId);
            }

            return options;
        }

        var tryGetProxyInfo = function(possibleProxyObject) {
            var proxyInfo = null;
            if (possibleProxyObject && typeof possibleProxyObject._getProxyPortInfo === "function") {
                proxyInfo = possibleProxyObject._getProxyPortInfo();
            }
            return proxyInfo;
        }

        var extensibleObjectCreator = function extensibleObjectCreator(proxyPortId, objectId, reference, groupId, specificType) {
            var obj = specificType === "array" ? [] : {};
            obj._getProxyPortInfo = function() {
                return {
                    proxyPortId: proxyPortId,
                    objectId: objectId,
                    reference: reference,
                    groupId: groupId
                };
            };
            return obj;
        };

        function createProxyFunction(serializedObject, jsonReference, proxyOptions) {
            var proxyFunctionBase = function () {
                    var deferral = PromiseUtil().defer(),
                        callId = Id.createCallId(),
                        argumentsArray = [this].concat(toArray(arguments));

                    callIdToDeferral[callId] = deferral;

                    postMessageToPort({
                        to: serializedObject.proxyPortId,
                        type: Id.messageIds.callFunction,
                        objectId: serializedObject.objectId,
                        functionReference: jsonReference,
                        callId: callId,
                        proxyOptions: proxyOptions,
                        arguments: argumentsArray.map(function (argument) {
                            return serializeObject(argument, proxyOptions.maximumDepth);
                        })
                    });

                    deferral.addEventListener("cancelled", function () {
                        postMessageToPort({
                            to: serializedObject.proxyPortId,
                            type: Id.messageIds.callFunctionCancelled,
                            callId: callId,
                            proxyOptions: proxyOptions
                        });
                    });

                    return deferral.promise;
                };

            return proxyFunctionBase;
        }

        function proxyResolver(proxyReference) {
            var unproxy = null;
            if (proxyReference.proxyPortId === proxyPortId) {
                unproxy = JsonReference.resolve(proxyReference.reference, getObjectIdToObject().get(proxyReference.objectId));
            }
            return unproxy;
        }

        function postMessageToPort(message) {
            var data = {
                type: Id.proxyPortMessageType,
                message: message
            }
            message.from = proxyPortId;
            port.postMessage(data);
        }

        function serializeObject(object, maximumDepth) {
            var serializedObject = ObjectSerializer.serialize(object, maximumDepth, tryGetProxyInfo);
            serializedObject.proxyPortId = proxyPortId;
            serializedObject.objectId = Id.createObjectId();
            getObjectIdToObject().add(serializedObject.objectId, object);
            return serializedObject;
        }

        function deserializeObject(serializedObject, proxyOptions) {
            proxyOptions = proxyOptions || {};
            var object = ObjectSerializer.deserialize(serializedObject, createProxyFunction, proxyResolver, extensibleObjectCreator.bind(null, serializedObject.proxyPortId, serializedObject.objectId), proxyOptions);
            var proxiesInGroup = groupIdToProxies[proxyOptions.groupId];
            if (!proxiesInGroup) {
                proxiesInGroup = [];
                groupIdToProxies[proxyOptions.groupId] = proxiesInGroup;
            }
            proxiesInGroup.push(object);
            return object;
        }

        this.postObject = function(object, proxyOptionsIn) {
            var proxyOptions = createOptions(proxyPortId, proxyPortOptions, proxyOptionsIn);

            postMessageToPort({
                to: Id.anyProxyPortId,
                type: Id.messageIds.postObject,
                proxyOptions: proxyOptions,
                object: serializeObject(object, proxyOptions.maximumDepth),
            });
        }

        function onPostObject(message) {
            var remoteObject = deserializeObject(message.object, message.proxyOptions);
            eventTarget.dispatchObjectEvent(remoteObject);
        }

        var closeProxy = function(proxy) {
            var proxyInfo = tryGetProxyInfo(proxy);
            if (proxyInfo) {
                postMessageToPort({ to: proxyInfo.proxyPortId, type: Id.messageIds.removeReference, objectId: proxyInfo.objectId });
            }
        }

        this.close = function () {
            var name;
            for (name in groupIdToProxies) {
                self.closeProxyGroup(name);
            }
            getObjectIdToObject().clear();
            port.removeEventListener("message", portListener);
        }

        function closeProxyGroupLocalHelper(groupId) {
            (groupIdToProxies[groupId] || []).forEach(closeProxy);
        }

        this.closeProxyGroup = function (proxy) {
            var groupId = proxy;
            if (typeof groupId !== "string") {
                groupId = tryGetProxyInfo(proxy).groupId;
            }
            postMessageToPort({ to: Id.anyProxyPortId, type: Id.messageIds.disconnect, groupId: groupId });
            closeProxyGroupLocalHelper(groupId);
        }
        
        function onCallFunctionCancelled(message) {
            var cancellable = callIdToCancellable[message.callId];
            if (cancellable) {
                cancellable.cancel();
                delete callIdToCancellable[message.callId];
            }
        }

        function onCallFunction(message) {
            var object = getObjectIdToObject().get(message.objectId),
                argumentProxies = message.arguments.map(function (serializedArgument) {
                    return deserializeObject(serializedArgument, message.proxyOptions);
                }),
                resolve = function (success, result, progress) {
                    delete callIdToCancellable[message.callId];
                    postMessageToPort({
                        type: Id.messageIds.callFunctionResolved,
                        to: message.from,
                        callId: message.callId,
                        success: success,
                        progress: !!progress,
                        proxyOptions: message.proxyOptions,
                        result: serializeObject(result, message.proxyOptions.maximumDepth)
                    });
                },
                resultingPromise;

            resultingPromise = PromiseUtil().wrap().then(function () {
                return JsonReference.resolve(message.functionReference, object).apply(argumentProxies[0], argumentProxies.slice(1));
            });
            
            resultingPromise.done(function (successResult) {
                resolve(true, successResult);
            }, function (failResult) {
                resolve(false, failResult);
            }, function (progressResult) {
                resolve(true, progressResult, true);
            });

            if (typeof resultingPromise.cancel === "function") {
                callIdToCancellable[message.callId] = resultingPromise;
            }
        }

        function onCallFunctionResolved(message) {
            var deferral = callIdToDeferral[message.callId];

            (message.progress ? deferral.notify : (message.success ? deferral.resolve : deferral.reject))
                (deserializeObject(message.result, message.proxyOptions));

            if (!message.progress) {
                delete callIdToDeferral[message.callId];
            }
        }

        function onDisconnect(message) {
            closeProxyGroupLocalHelper(message.groupId);
        }

        function onAddReference(message) {
            getObjectIdToObject().addReference(message.objectId);
        }

        function onRemoveReference(message) {
            getObjectIdToObject().removeReference(message.objectId);
        }

        var portListener = function (event) {
            if (event && event.data && event.data.type && event.data.type === Id.proxyPortMessageType) {
                var message = event.data.message;
                if (message.to === Id.anyProxyPortId || message.to === proxyPortId) {
                    try {
                        switch (message.type) {
                            case Id.messageIds.postObject:
                                onPostObject(message);
                                break;
                            case Id.messageIds.callFunction:
                                onCallFunction(message);
                                break;
                            case Id.messageIds.callFunctionResolved:
                                onCallFunctionResolved(message);
                                break;
                            case Id.messageIds.callFunctionCancelled:
                                onCallFunctionCancelled(message);
                                break;
                            case Id.messageIds.disconnect:
                                onDisconnect(message);
                                break;
                            case Id.messageIds.addReference:
                                onAddReference(message);
                                break;
                            case Id.messageIds.removeReference:
                                onRemoveReference(message);
                                break;
                            default:
                                throw new Error("Unexpected message type: " + message.type);
                                break;
                        }
                    }
                    catch (e) {
                        console.error("Error in message event handler " + proxyPortId + ": " + e);
                        console.error(e.stack);
                        throw e;
                    }
                }
            }
        };
        port.addEventListener("message", portListener);
    }

    var MessagePortWithOrigin = function (postMessageSource, messageEventSource, origin) {
        var eventTarget = new EventTarget(this, ["message"]),
            messageHandler,
            postOrigin,
            matchOrigin;

        if (!this instanceof MessagePortWithOrigin) {
            throw new TypeError("MessagePortWithOrigin is a constructor and must be called with new.");
        }
        if (!origin) {
            if (document.location.protocol === "file:") {
                postOrigin = "*";
                matchOrigin = null;
            }
            else {
                matchOrigin = document.location.protocol + "//" + document.location.hostname;
                if (document.location.port.length) {
                    matchOrigin += ":" + document.location.port;
                }
                postOrigin = matchOrigin;
            }
        }
        else if (origin !== "*") {
            postOrigin = matchOrigin = origin;
        }
        else {
            throw new Error("origin must be specific and not generic *");
        }

        this.postMessage = function () {
            var argumentsArray = toArray(arguments);
            argumentsArray.splice(1, 0, postOrigin);
            postMessageSource.postMessage.apply(postMessageSource, argumentsArray);
        }

        this.close = function () {
            messageEventSource.removeEventListener("message", messageHandler);
            messageEventSource = null;
            messageHandler = null;
            postMessageSource = null;
        }

        messageHandler = function (event) {
            if (event.origin === matchOrigin || matchOrigin === null) {
                eventTarget.dispatchMessageEvent(event);
            }
            else {
                console.error("MessagePortWithOrigin: Discarding message with non matching origin: event " + event.origin + " !== expected " + matchOrigin);
            }
        };
        messageEventSource.addEventListener("message", messageHandler);
    }
    ProxyPort.MessagePortWithOrigin = MessagePortWithOrigin;

    var MessagePortOverString = function (callOutFunction) {
        var eventTarget = new EventTarget(this, ["message"]);
        if (!this instanceof MessagePortOverString) {
            throw new TypeError("MessagePortOverString is a constructor and must be called with new.");
        }

        this.incomingMessage = function (messageAsString) {
            var messageAsObject = JSON.parse(messageAsString);
            eventTarget.dispatchMessageEvent({ data: messageAsObject });
        }

        this.postMessage = function (messageAsObject) {
            callOutFunction(JSON.stringify(messageAsObject));
        }

        this.close = function () { };
    }
    ProxyPort.MessagePortOverString = MessagePortOverString;

    var MessagePortWithLogging = function (port, consoleLog) {
        var eventTarget = new EventTarget(this, ["message"]),
            propertiesToLog = ["to", "from", "type", "objectId", "callId", "functionReference", "success"];

        if (!this instanceof MessagePortWithLogging) {
            throw new TypeError("MessagePortWithLogging is a constructor and must be called with new.");
        }

        function getLoggingFromData(data) {
            var loggingPrimaryString,
                loggingSecondaryString = "";

            if (data && data.type) {
                if (data.type === Id.proxyPortMessageType) {
                    loggingPrimaryString = JSON.stringify(applyObjectProperties({}, getObjectProperties(data.message).filter(function (property) {
                        return propertiesToLog.indexOf(property.name) !== -1;
                    })));
                    try {
                        loggingSecondaryString = JSON.stringify(applyObjectProperties({}, getObjectProperties(data.message).filter(function (property) {
                            return propertiesToLog.indexOf(property.name) === -1;
                        })));
                    }
                    catch (e) { }
                }
                else if (data.type === Id.proxyServerMessageType) {
                    loggingPrimaryString = JSON.stringify(data.message);
                }
            }

            return loggingPrimaryString + loggingSecondaryString;
        }

        function logData(prefix, data) {
            var loggingData = getLoggingFromData(data);
            if (loggingData) {
                consoleLog(prefix + ": " + loggingData);
            }
        }

        port.addEventListener("message", function (event) {
            logData("recv", event.data);
            eventTarget.dispatchMessageEvent(event);
        });

        this.postMessage = function (message) {
            logData("sent", message);
            port.postMessage.apply(port, arguments);
        }

        this.close = port.close ? port.close.bind(port) : function() {};
    }
    ProxyPort.MessagePortWithLogging = MessagePortWithLogging;

    // server.initializeAsync(options)
    // server.getMessagePort()
    // server.close()
    var ProxyClient = function (server, options) {
        options = options || {};
        options.proxyPortUri = options.proxyPortUri || "proxyPort.js";
        options.debugConsoleLog = options.debugConsoleLog || undefined;
        options.proxyPortOptions = options.proxyPortOptions || {};

        if (!this instanceof ProxyClient) {
            throw new TypeError("ProxyClient is a constructor and must be called with new.");
        }

        var controller,
            messagePort,
            objectPort,
            initializeGuard = function () { if (!controller) throw new Error("Must initialize ProxyClient first."); },
            that = this;

        this.importScriptsAsync = function (scriptUris) {
            initializeGuard();
            return controller.importScriptsAsync(scriptUris);
        }

        this.getObjectAsync = function (jsonReference) {
            initializeGuard();
            return controller.getObjectAsync(jsonReference);
        }

        this.initializeAsync = function (scriptUris, remoteRootObjectJsonReference) {
            return server.initializeAsync(options).then(function (messagePortIn) {
                var deferral = PromiseUtil().defer(),
                    connectedHandler = function (event) {
                        messagePort.removeEventListener("message", connectedHandler);
                        console.assert(event.data && event.data.type === Id.proxyServerMessageType && event.data.message.type === Id.messageIds.serverConnected);
                        objectPort = new ProxyPort(messagePort, options.proxyPortOptions);

                        objectPort.postObject(function setController(controllerIn) {
                            var promise = PromiseUtil().wrap();

                            controller = controllerIn;
                            if (remoteRootObjectJsonReference) {
                                promise = that.getObjectAsync(remoteRootObjectJsonReference);
                            }

                            promise.then(function (result) {
                                deferral.resolve(result);
                            }, function (error) {
                                deferral.reject(error);
                            });
                        });
                    };
                messagePort = options.debugConsoleLog ? new MessagePortWithLogging(messagePortIn, options.debugConsoleLog) : messagePortIn;
                messagePort.addEventListener("message", connectedHandler);
                messagePort.postMessage({ type: Id.proxyServerMessageType, message: { type: Id.messageIds.serverInitialize, importScriptUris: scriptUris } });

                return deferral.promise;
            });
        }

        this.close = function () {
            controller = null;
            server.close();
            objectPort.close();
            messagePort.close();
        }
    };

    var createProxySandboxAsync = function (scriptUris, options) {
        var messagePort,
            sandboxServer = {
                getMessagePort: function () { return messagePort; },
                close: null,
                initializeAsync: function () {
                    var deferral = PromiseUtil().defer(),
                        loadedEvent,
                        errorEvent,
                        scriptNotifyEvent,
                        element;

                    // Todo need to figure out navigation error and other errors that can occur before DOMContentLoaded and hookup to deferral
                    if (typeof MSHTMLWebViewElement !== "undefined" && !options.forceIframe) {
                        element = document.createElement("x-ms-webview");

                        loadedEvent = function () {
                            messagePort = new MessagePortOverString(function (messageAsString) {
                                var invokeAction = element.invokeScriptAsync("proxyPortPostMessageToServer", messageAsString);
                                invokeAction.oncomplete = function () {
                                    if (invokeAction.readyState === invokeAction.ERROR) {
                                        console.error("Error invokeScriptAsync: " + invokeAction.error);
                                    }
                                };
                                invokeAction.start();
                            })
                            element.removeEventListener("MSWebViewDOMContentLoaded", loadedEvent);
                            loadedEvent = null;
                            element.parentElement.removeChild(element);
                            deferral.resolve(messagePort);
                        };
                        element.addEventListener("MSWebViewDOMContentLoaded", loadedEvent);

                        errorEvent = function () {
                            deferral.reject("Failed to create webview.");
                        }
                        element.addEventListener("error", errorEvent);

                        scriptNotifyEvent = function (event) {
                            messagePort.incomingMessage(event.value);
                        };
                        element.addEventListener("MSWebViewScriptNotify", scriptNotifyEvent);

                        sandboxServer.close = function () {
                            element.removeEventListener("MSWebViewScriptNotify", scriptNotifyEvent);
                            scriptNotifyEvent = null;
                            element = null;
                        }

                        element.style.display = "none";
                        document.body.appendChild(element);
                        element.navigate(options.proxyPortSandboxUri + "?command=startServerMSWebView");
                    }
                    else {
                        if (typeof WebView !== "undefined" && !options.forceIframe) {
                            element = document.createElement("webview");
                        }
                        else {
                            element = document.createElement("iframe");
                        }
                        element.setAttribute("sandbox", "allow-scripts");

                        loadedEvent = function () {
                            var channel = new MessageChannel(),
                                serverReadyHandler = function (event) {
                                    if (event.data.type === Id.proxyServerMessageType && event.data.message.type === Id.messageIds.serverReady) {
                                        messagePort = channel.port1;
                                        deferral.resolve(messagePort);
                                        channel.port1.removeEventListener("message", serverReadyHandler);
                                    }
                                };
                            channel.port1.start();
                            channel.port2.start();
                            channel.port1.addEventListener("message", serverReadyHandler);
                            element.contentWindow.postMessage(
                                { type: Id.proxyServerMessageType, message: { type: Id.messageIds.serverPortInitialize } },
                                options.proxyPortSandboxOrigin || "*",
                                [channel.port2]);
                            element.removeEventListener("error", errorEvent);
                            element.removeEventListener("load", loadedEvent);
                            errorEvent = null;
                            loadedEvent = null;
                        };
                        element.addEventListener("load", loadedEvent);

                        errorEvent = function () {
                            element.removeEventListener("error", errorEvent);
                            element.removeEventListener("load", loadedEvent);
                            errorEvent = null;
                            loadedEvent = null;
                            deferral.reject("Error loading iframe.");
                        }
                        element.addEventListener("error", errorEvent);

                        sandboxServer.close = function () {
                            element.setAttribute("src", "about:blank");
                            element.parentElement.removeChild(element);
                            element = null;
                        };

                        element.setAttribute("src", options.proxyPortSandboxUri + "?command=startServer");
                        element.style.display = "none";
                        document.body.appendChild(element);
                    }

                    return deferral.promise;
                }
            },
            proxyClient;

        options = options || {};
        options.debugConsoleLog = options.debugConsoleLog || undefined;
        options.forceIframe = options.forceIframe || false;
        options.proxyPortOptions = options.proxyPortOptions || {};
        options.proxyPortSandboxUri = options.proxyPortSandboxUri || "proxyPortSandbox.html";
        options.proxyPortSandboxOrigin = options.proxyPortSandboxOrigin || undefined;
        options.get = options.get || undefined;

        proxyClient = new ProxyClient(sandboxServer, options);
        return proxyClient.initializeAsync(scriptUris, options.get).then(function (root) {
            return {
                client: proxyClient,
                root: root
            }
        });
    }
    ProxyPort.createProxySandboxAsync = createProxySandboxAsync;

    var createProxyWorkerAsync = function createProxyWorkerAsync(scriptUris, options) {
        var worker,
            messagePort,
            workerServer = {
                close: function () {
                    worker.terminate();
                    worker = null;
                    messagePort = null;
                },
                getMessagePort: function () { return messagePort; },
                initializeAsync: function () {
                    var deferral = new PromiseUtil().defer();

                    worker = new Worker(options.proxyPortUri + "?command=startServer"),
                    messagePort = options.debugConsoleLog ? new ProxyPort.MessagePortWithLogging(worker, options.debugConsoleLog) : worker;

                    deferral.resolve(messagePort);

                    return deferral.promise;
                }
            },
            proxyClient;

        options = options || {};
        options.proxyPortUri = options.proxyPortUri || "proxyPort.js";
        options.debugConsoleLog = options.debugConsoleLog || undefined;
        options.proxyPortOptions = options.proxyPortOptions || {};
        options.get = options.get || {};

        proxyClient = new ProxyClient(workerServer, options);
        return proxyClient.initializeAsync(scriptUris, options.get).then(function (root) {
            return {
                client: proxyClient,
                root: root
            }
        });
    }
    ProxyPort.createProxyWorkerAsync = createProxyWorkerAsync;

    var getJsonpAsync = function (client, jsonpUri, options) {
        var result,
            deferral,
            scriptElement,
            callbackCalled = false;

        if (!options.callbackName && !options.globalName) {
            throw new Error("Must provide either callbackName or globalName in the options.");
        }

        if (client !== undefined) {
            result = client.getObjectAsync("$.ProxyPort").then(function (remoteProxyPort) {
                return remoteProxyPort.getJsonpAsync(undefined, jsonpUri, options);
            });
        }
        else {
            deferral = PromiseUtil().defer();
            result = deferral.promise;

            if (options.callbackName) {
                root[options.callbackName] = function (result) {
                    deferral.resolve(result);
                    callbackCalled = true;
                }
            }

            scriptElement = document.createElement("script");
            scriptElement.addEventListener("load", function () {
                if (!options.callbackName) {
                    if (root.hasOwnProperty(options.globalName)) {
                        deferral.resolve(root[options.globalName]);
                    }
                    else {
                        deferral.reject(new Error("No property " + options.globalName + " defined by JSONP"));
                    }
                }
                else {
                    if (!callbackCalled) {
                        deferral.reject(new Error("JSONP did not execute callback: " + options.callbackName));
                    }
                }
            });
            scriptElement.addEventListener("error", function (error) {
                deferral.reject(new Error("Error loading script: " + jsonpUri));
            });
            scriptElement.setAttribute("src", jsonpUri);
            document.head.appendChild(scriptElement);
        }
        return result;
    }
    ProxyPort.getJsonpAsync = getJsonpAsync;

    // proxyPort.js can be imported for the additional purpose of starting a proxyPort server in the case of:
    //  - a webworker specifying proxyPort with a query property including command=startServer: new Worker("http://example.com/proxyPort.js?command=startServer")
    //  - a sandboxed html document (iframe, webview) that has a data-proxyport-command="startServer" attribute: <script src="proxyPort.js" data-proxyport-command="startServer"></script>
    // In either case we listen to the incoming message port for proxyServerMessageType containing any additional scripts to add and notice to connect a ProxyPort
    // We have to handle the imported scripts out of band so that the client can tell the server of dependency JS library locations (Q or WinJS) before creating a ProxyPort
    (function possiblyInitializeServer() {
        var port,
            importScriptsAsync,
            initializeObjectHandler = function (getController) {
                port.removeEventListener("object", initializeObjectHandler);

                getController({
                    importScriptsAsync: importScriptsAsync,
                    getObjectAsync: function (jsonReference) { return JsonReference.resolve(jsonReference, root); }
                });
            },
            connectPort = function (messagePort) {
                port.addEventListener("object", initializeObjectHandler);
                messagePort.postMessage({ type: Id.proxyServerMessageType, message: { type: Id.messageIds.serverConnected }});
            },
            importsInProgress = 0,
            pendingMessages = [],
            donePending = false;

        if (typeof importScripts === "function" && location.search === "?command=startServer") {
            console.log("Initializing worker proxy server " + (location ? location : document.location));
            // WebWorker test
            var initializeWorkerHandler = function (event) {
                    if (event.data.type && event.data.type === Id.proxyServerMessageType) {
                        removeEventListener("message", initializeWorkerHandler);
                        for (var idx = 0; idx < event.data.message.importScriptUris.length; idx++) {
                            importScripts(event.data.message.importScriptUris[idx]);
                        }
                        port = new ProxyPort(root);
                        connectPort(self);
                    }
                };
            addEventListener("message", initializeWorkerHandler);
            importScriptsAsync = function (scriptUris) { importScripts(scriptUris); }
        }
        else if (typeof document !== "undefined") {
            console.log("Initializing proxy server " + (location ? location : document.location));
            if (document.location.search === "?command=startServer") {
                // Iframe, new window, Chrome packaged app webview, Chrome new window all use the same postMessage contract
                var temporaryPort,
                    windowMessageHandler = function (event) {
                        console.assert(event.data && event.data.type === Id.proxyServerMessageType && event.data.message.type === Id.messageIds.serverPortInitialize);
                        temporaryPort = event.ports[0];
                        temporaryPort.addEventListener("message", portMessageHandler);
                        temporaryPort.start();
                        temporaryPort.postMessage({ type: Id.proxyServerMessageType, message: { type: Id.messageIds.serverReady }});
                        window.removeEventListener("message", windowMessageHandler);
                    },
                    portMessageHandler = function (event) {
                        if (event.data && event.data.type === Id.proxyServerMessageType && event.data.message.type === Id.messageIds.serverInitialize) {
                            temporaryPort.removeEventListener("message", portMessageHandler);

                            importScriptsAsync(event.data.message.importScriptUris,
                                function () {
                                    port = new ProxyPort(temporaryPort);
                                    connectPort(temporaryPort);
                                });
                        }
                    };
                window.addEventListener("message", windowMessageHandler);
            }
            else if (document.location.search === "?command=startServerMSWebView") {
                // Only Win8.1 WWA webview has a different contract
                var messagePortOverString = new MessagePortOverString(function (str) { window.external.notify(str); });

                port = new ProxyPort(messagePortOverString);
                root.proxyPortPostMessageToServer = function (messageAsJson) {
                    var message = JSON.parse(messageAsJson);
                    
                    if (message.type === Id.proxyServerMessageType) {
                        importScriptsAsync(message.message.importScriptUris);
                    }
                    else if (importsInProgress === 0 && donePending) {
                        messagePortOverString.incomingMessage(messageAsJson);
                    }
                    else {
                        pendingMessages.push(messageAsJson);
                    }
                }
                connectPort(messagePortOverString);
            }

            // Promises here would make this much simpler. However this is the mechanism that loads the promise implementation library.
            importScriptsAsync = function (scriptUris, callback) {
                var importSettled = function () {
                    --importsInProgress;
                    if (importsInProgress === 0) {
                        setTimeout(function () {
                            while (pendingMessages.length > 0) {
                                messagePortOverString.incomingMessage(pendingMessages.splice(0, 1)[0]);
                            }
                            donePending = true;
                            callback();
                        }, 0);
                    }
                }
                importsInProgress += scriptUris.length;
                donePending = false;
                scriptUris.forEach(function (scriptUri) {
                    var scriptElement = document.createElement("script");
                    scriptElement.onerror = function () {
                        console.error("unable to load script: " + scriptUri);
                        importSettled();
                    }
                    scriptElement.onload = function () {
                        importSettled();
                    }
                    scriptElement.src = scriptUri;
                    document.head.appendChild(scriptElement);
                });
            };
        }
    })();

    return ProxyPort;
})();
