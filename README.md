# ProxyPort library
Interact with objects in a web worker, sandboxed iframe, or any other distinct JavaScript execution context without writing message passing code. A ProxyPort sends objects and receives proxies and on top of that layers helpers to easily create a ProxyPort controlled web worker or sandbox.

## ProxyPort object
A ProxyPort communicates over any MessagePort-like object allowing you to send objects and receive proxies.

	var proxyPort = new ProxyPort(messagePort, defaultOptions);
	proxyPort.addEventListener("object", function(proxy) { ... });
	proxyPort.postObject(originalObject, overrideOptions);

See Communication channel below for more on the messagePort parameter, but generally it should act like a MessagePort.
The defaultOptions and overrideOptions parameters are optional parameters allowing you to specify some optional values. Options travel with a proxy and any objects proxied via that proxy inherit those same options. Options specified in the ProxyPort constructor's defaultOptions are the default for any objects proxied via that ProxyPort, but you may additionally override the options on a specific call with the overrideOptions parameter to postObject. Option values:
 - options.maximumDepth - A number specifying the maximum depth to recursively explore properties on an original object when constructing a proxy. Useful for DOM objects for example which end up pointing to the entire DOM tree. Defaults to Inifinite.
 - options.groupId - A proxy object the group of which to add proxies created via this ProxyPort or this call to postObject. See Cleanup for more information on how groups are used. Defaults to undefined in which case a new group is created and inheritted by all proxied objects.

### Proxy
An original object provided to ProxyPort.postObject creates a proxy corresponding to the original object in any connected ProxyPort. A proxy is a copy of the original object except for functions (and except if you set options.maximumDepth described above). Functions on the proxy return a Promise/A+ style promise that runs the promise resolution procedure on the result of calling the corresponding function on the original object. Accordingly if the original object function returns a promise then the proxy object function returns a promise that succeeds, fails or reports progress as the original object promise does. Or if the original object synchronously returns a value or throws an exception the proxy promise succeeds or fails respectively. All function parameters provided to a proxy function are provided to the original object's function as proxies and all success, failure or progress values reported via the proxy function promise are proxies to their corresponding objects on the original side.
Proxies sent back through their ProxyPort to the original object side, produce their original object.
Original objects may contain cycles or references to proxies.

### Communication channel
The messagePort object passed to ProxyPort constructor is an object like a MessagePort with the following APIs:

	messagePort.postMessage(data);
	messagePort.addEventListener("message", function(message) { ... });
	messagePort.removeEventListener("message", function(message) { ... });

Note that this is the origin-less variant of postMessage for example a MessageChannel port, or Worker object.

An iframe, frame, or child window receives messages on the current window and uses the origin requiring variant of postMessage. You can use the ProxyPort.MessagePortWithOrigin consructor to adapt the origin variant to the origin-less variant:

	var origin = "http://example.com",
		messagePort = new ProxyPort.MessagePortWithOrigin(iframe.contentWindow, window, origin),
		proxyPort = new ProxyPort(messagePort);

The first parameter to the ProxyPort.MessagePortWithOrigin constructor is an object with the origin variant of postMessage. 
The second is an object with a message event and add/removeEventListener methods. 
The third is an optional origin parameter used to validate incoming message events and specified when calling postMessage. It defaults to the current document's origin -- it defaults to same origin.

The data that ProxyPort passes to the messagePort.postMessage is JSON serializable. To easily connect up to arbitrary APIs you can use the ProxyPort.MessagePortOverString:

	var messagePort = new ProxyPort.MessagePortOverString(callOutFunction);
	messagePort.incomingMessage(exampleString);

The constructor parameter is a function that will be called by postMessage with a stringified version of the proxy data. Call the incomingMessage method with a string to have the messagePort's message event fired.

### Cleanup
To totally cleanup all proxies, proxy function promises and disconnect from its messagePort call close:

	proxyPort.close();

To cleanup a group of proxies and associated proxy function promises, call closeProxyGroup with a proxy from the group. For instance the following cleans up a, and b, but not c:

	var a,
		b,
		c;
	proxyPort.addEventListener("object", function(obj) {
		if (!a) {
			a = obj;
			a.getB().then(function(obj) {
				b = obj;
			});
		}
		else {
			c = obj;
		}
	});
	...
	proxyPort.closeProxyGroup(a);

## Helpers
To make specific use cases even simpler, use the following helpers.

### ProxyWorker
To create a web worker controlled via ProxyPort use createProxyWorkerAsync:

	var scriptUris = ["q.js", "example.js"],
		proxyWorkerOptions = { get: "$.example" };
	ProxyPort.createProxyWorkerAsync(scriptUris, proxyWorkerOptions).then(function(result) {
		result.root.performOperation().then(...);
		result.client.closeProxyGroup(result.root);
	});

Call createProxyWorkerAsync with an array of script URIs to load in the worker and an optional proxyWorkerOptions object. Options:
 - proxyWorkerOptions.get - A string containing a JSON reference identifying the object in the worker to return. Defaults to not obtaining an object.
 - proxyWorkerOptions.proxyPortUri - URI referring to the proxyPort.js script. Defaults to "proxyPort.js" e.g. a relative URI pointing to the current location's folder.
 - proxyWorkerOptions.debugConsoleLog - A logging function to connect for debugging purposes. For instance console.log.bind(console). Defaults to undefined and no logging.
 - proxyWorkerOptions.proxyPortOptions - A ProxyPort options object to be used with the creation of internal ProxyPort objects.

The method returns a promise containing an object with two properties:
 - result.root - The proxy identified by proxyWorkerOptions.get (if any).
 - result.client - The ProxyClient object corresponding to the ProxyWorker. Contains methods getObjectAsync(jsonReference) and importScriptsAsync(scriptUris).

### ProxySandbox
To create a sandboxed DOM controlled via ProxyPort use createProxySandboxAsync:

	var scriptUris = ["q.js", "example.js"],
		proxySandboxOptions = { get: "$.example" };
	ProxyPort.createProxySandboxAsync(scriptUris, proxySandboxOptions).then(function(result) {
		result.root.performOperation().then(...);
		result.client.closeProxyGroup(result.root);
	});

Call createProxySandboxAsync with an array of script URIs to load in the sandbox and an optional proxySandboxOptions object. Options:
 - proxySandboxOptions.get - A string containing a JSON reference identifying the object in the worker to return. Defaults to not obtaining an object.
 - proxySandboxOptions.proxyPortSandboxUri - URI referring to the proxyPortSandbox.html resource. Defaults to "proxyPortSandbox.html" e.g. a relative URI pointing to the current location's folder.
 - proxySandboxOptions.proxyPortSandboxOrigin - Origin to use when communicating with a sandbox over origin style MessagePort. Defaults to same origin as caller.
 - proxySandboxOptions.debugConsoleLog - A logging function to connect for debugging purposes. For instance console.log.bind(console). Defaults to undefined and no logging.
 - proxySandboxOptions.proxyPortOptions - A ProxyPort options object to be used with the creation of internal ProxyPort objects.
 - proxySandboxOptions.forceIframe - Force the sandboxing mechanism to be iframe rather than webview.

The method returns a promise containing an object with two properties:
 - result.root - The proxy identified by proxySandboxOptions.get (if any).
 - result.client - The ProxyClient object corresponding to the ProxySandbox. Contains methods getObjectAsync(jsonReference) and importScriptsAsync(scriptUris).

### Safe JSONP
Many web app platforms have strict CSP requirements that block normal JSONP mechanisms. You can use	ProxyPort.getJsonpAsync in combination with createProxySandboxAsync to safely obtain JSON data from a JSONP script.

	var scriptUris = ["q.js", "example.js"];
	ProxyPort.createProxySandboxAsync(scriptUris).then(function(result) {
		return ProxyPort.getJsonpAsync(result.client, "http://example.com/example?a=jsonp&c=callback", { callbackName: "callback" });
	}).then(function(jsonData) {
		...
	});

