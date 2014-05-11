(function () {
    "use strict";

    function createProxyPortsOnChannel(console, options) {
        var channel = new MessageChannel();
        channel.port1.start();
        channel.port2.start();
        return {
            port1: new ProxyPort(new ProxyPort.MessagePortWithLogging(channel.port1, console.log.bind(console)), options),
            port2: new ProxyPort(channel.port2, options)
        };
    }

    asyncTest("ProxyPort post simple number", 2, function () {
        var channel = createProxyPortsOnChannel(console),
            result;

        channel.port2.addEventListener("object", function (object) {
            result = object;
        });
        channel.port1.postObject(1);

        delayAsync(100).then(function () {
            equal(result, 1);
            equal(typeof result, "number");
            start();
        });
    });

    asyncTest("ProxyPort post two strings", 2, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [];

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject("first");
        channel.port1.postObject("second");

        delayAsync(100).then(function () {
            equal(results[0], "first");
            equal(results[1], "second");
            start();
        });
    });

    asyncTest("ProxyPort post array of arrays of numbers", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            value = [[1, 2, 3], [4], [[5], 6]];

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(value);

        delayAsync(100).then(function () {
            console.log("received: " + JSON.stringify(results[0]));
            console.log("expected: " + JSON.stringify(value));
            equal(JSON.stringify(results[0]), JSON.stringify(value));
            start();
        });
    });

    asyncTest("ProxyPort post object of null like values", 3, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            value = {n: null, u: undefined, z: 0, f: false};

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(value);

        delayAsync(100).then(function () {
            console.log("received: " + JSON.stringify(results[0]));
            console.log("expected: " + JSON.stringify(value));
            equal(JSON.stringify(results[0]), JSON.stringify(value));
            equal(results[0].hasOwnProperty("u"), true);
            equal(results[0].u, undefined);
            start();
        });
    });

    asyncTest("ProxyPort post undefined", 1, function () {
        var channel = createProxyPortsOnChannel(console);

        channel.port2.addEventListener("object", function (object) {
            equal(object, undefined);
            start();
        });
        channel.port1.postObject(undefined);
    });

    asyncTest("ProxyPort post null", 1, function () {
        var channel = createProxyPortsOnChannel(console);

        channel.port2.addEventListener("object", function (object) {
            equal(object, null);
            start();
        });
        channel.port1.postObject(null);
    });

    asyncTest("ProxyPort post array like object containing array", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            value = { 0: "a", 1: ["b", "c"], length: 2 };

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(value);

        delayAsync(100).then(function () {
            console.log("received: " + JSON.stringify(results[0]));
            console.log("expected: " + JSON.stringify(value));
            equal(JSON.stringify(results[0]), JSON.stringify(value));
            start();
        });
    });

    asyncTest("ProxyPort post sequence of various objects", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [1, ["a", { b: "b" }, 3], { a: "b" }, "abc", null];

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            console.log("received: " + JSON.stringify(results));
            console.log("expected: " + JSON.stringify(values));
            equal(JSON.stringify(results), JSON.stringify(values));
            start();
        });
    });

    asyncTest("ProxyPort post object with cycles", 4, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            obj = { a: undefined };

        obj.a = obj;
        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            equal(results[0].hasOwnProperty("a"), true);
            equal(results[0].a, results[0]);
            equal(values[0].hasOwnProperty("a"), true);
            equal(values[0].a, values[0]);
            start();
        });
    });

    asyncTest("ProxyPort post function", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            called = false;

        channel.port2.addEventListener("object", function (fn) {
            fn().then(function () {
                equal(called, true);
                start();
            });
        });
        channel.port1.postObject(function () { called = true; });
    });

    asyncTest("ProxyPort post object with simple function", 3, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = { a: function () { return ++count; } };

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            equal(result, 1);
            return results[0].a();
        }).then(function (result) {
            equal(result, 2);
            equal(result, count);
            start();
        });
    });

    asyncTest("ProxyPort post object with simple throwing function", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = { a: function () { throw new Error("Always fail"); } },
            success = true;

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            success = true;
        }, function (fail) {
            success = false;
        }).then(function () {
            equal(!success, true);
            start();
        });
    });

    asyncTest("ProxyPort post object with promise failing function", 2, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = {
                a: function () {
                    return wrapPromiseError(456);
                }
            },
            success = true;

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            success = true;
        }, function (fail) {
            equal(fail, 456);
            success = false;
        }).then(function () {
            equal(!success, true);
            start();
        });
    });

    asyncTest("ProxyPort post object with promise function", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = {
                a: function () {
                    return wrapPromiseValue(123);
                }
            };

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            equal(result, 123);
            start();
        });
    });

    asyncTest("ProxyPort post object called through object function", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            objA = { a: function () { return ++count; } },
            objB = { b: function (obj) { return obj.a(); } };

        values.push(objB);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            return results[0].b(objA);
        }).then(function (result) {
            equal(result, 1);
            start();
        });
    });

    asyncTest("ProxyPort post proxy unproxying", 2, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            objA = { a: function (obj) { return obj; } },
            objB = { "abc": 123 };

        values.push(objA);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        delayAsync(100).then(function () {
            return results[0].a(objB);
        }).then(function (result) {
            equal(objB.abc, 123);
            console.log("objB looks correct, but is it exactly the same object?");
            equal(objB, result);
            start();
        });
    });

    asyncTest("ProxyPort limit object depth", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            obj = { a: { b: { c: { d: { e: 7 } } } } };

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(obj, { maximumDepth: 3 });

        delayAsync(100).then(function () {
            equal(JSON.stringify(results[0]), JSON.stringify({ a: { b: {} } }));
            start();
        });
    });

    asyncTest("ProxyPort inherit object depth", 2, function () {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            objA = { a: { b: { c: { d: { e: 7 } } } }, r: function () { return objB; } },
            objB = { f: { g: { h: { i: { j: 7 } } } } };

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(objA, { maximumDepth: 3 });

        delayAsync(100).then(function () {
            console.log(JSON.stringify(results[0]));
            equal(JSON.stringify(results[0]), JSON.stringify({ a: { b: {} } }));
            return results[0].r();
        }).then(function (obj) {
            console.log(JSON.stringify(obj));
            equal(JSON.stringify(obj), JSON.stringify({ f: { g: {} } }));
            start();
        });
    });

    asyncTest("ProxyPort cleanup one proxy", 1, function () {
        var channel = createProxyPortsOnChannel(console),
            garbage = { a: "b" };

        channel.port1.addEventListener("objectRemoved", function (key) {
            equal(1, 1);
            start();
        });
        channel.port2.addEventListener("object", function (object) { channel.port2.closeProxyGroup(object); });
        channel.port1.postObject(garbage);
    });

    asyncTest("ProxyPort cleanup two proxies on both sides", 4, function () {
        var channel = createProxyPortsOnChannel(console),
            removedCount = 0,
            expectedRemoveCount = 3,
            obj = {
                run: function (workItemProxy) {
                    return workItemProxy(this); // this (proxies not reused) - o87
                }
            }; // obj - o81

        function onRemove(debugName, key) {
            console.log(debugName + ": " + key);
            ++removedCount;
            equal(removedCount <= expectedRemoveCount, true);
            if (removedCount === expectedRemoveCount) {
                equal(removedCount, expectedRemoveCount);
                start();
            }
        }

        channel.port1.addEventListener("objectRemoved", onRemove.bind(null, "port1 objectRemoved"));
        channel.port2.addEventListener("objectRemoved", onRemove.bind(null, "port2 objectRemoved"));

        channel.port2.addEventListener("object", function (objProxy) {
            objProxy.run(function workItem(objProxy) { // workItem - o84
                channel.port2.closeProxyGroup(objProxy);
            });
        });
        channel.port1.postObject(obj);

        // port1 local side            | port2 local side
        // postObject obj           -> | -> objProxy81
        // obj.run(workItemProxy84) <- | <- objProxy81.run(workItem)
        // workItemProxy84(obj)     -> | -> workItem(objProxy87)
    });

    asyncTest("ProxyWorker create, use, and close", 1, function () {
        ProxyPort.createProxyWorkerAsync([getPromiseUri(), "test/common/es5-shim.js", "test/common/es6-shim.js"], { get: "$", proxyPortUri: "../../proxyPort.js", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            console.log(result.root.location.href);
            equal(result.root.location.pathname.indexOf("proxyPort.js") !== -1, true);
            result.client.close();
            start();
        });
    });

    asyncTest("ProxySandbox create, use, and close", 1, function () {
        ProxyPort.createProxySandboxAsync([getPromiseUri(), "test/common/es5-shim.js", "test/common/es6-shim.js"], { get: "$.document.location", proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            console.log(result.root.href);
            equal(result.root.pathname.indexOf("proxyPortSandbox.html") !== -1, true);
            result.client.close();
            start();
        });
    });

    asyncTest("ProxySandbox JSONP callback success", 1, function () {
        var client;
        ProxyPort.createProxySandboxAsync([getPromiseUri(), "test/common/es5-shim.js", "test/common/es6-shim.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/common/jsonp-example-callback.jsonp", { callbackName: "foo" });
        }).then(function (jsonpObj) {
            equal(jsonpObj.length > 0, true);
            client.close();
            start();
        });
    });

    asyncTest("ProxySandbox JSONP global success", 1, function () {
        var client;
        ProxyPort.createProxySandboxAsync([getPromiseUri(), "test/common/es5-shim.js", "test/common/es6-shim.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/common/jsonp-example-global.jsonp", { globalName: "foo" });
        }).then(function (jsonpObj) {
            equal(jsonpObj.length > 0, true);
            client.close();
            start();
        });
    });

    asyncTest("ProxySandbox JSONP throw failure", 1, function () {
        var client;
        ProxyPort.createProxySandboxAsync([getPromiseUri(), "test/common/es5-shim.js", "test/common/es6-shim.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/common/jsonp-example-throw.jsonp", { globalName: "foo" });
        }).then(function (jsonpObj) {
            equal(false, true);
            start();
        }, function (error) {
            equal(true, true);
            console.log("Jsonp expected failure: " + error);
            client.close();
            start();
        });
    });

    asyncTest("ProxySandbox JSONP callback fails to callback", 1, function () {
        var client;
        ProxyPort.createProxySandboxAsync([getPromiseUri(), "test/common/es5-shim.js", "test/common/es6-shim.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/common/jsonp-example-global.jsonp", { callbackName: "foo" });
        }).then(function (jsonpObj) {
            equal(false, true);
            client.close();
        }, function (error) {
            equal(true, true);
            console.log("Jsonp expected failure: " + error);
            client.close();
            start();
            return "success";
        });
    });
}());