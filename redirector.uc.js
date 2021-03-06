// ==UserScript==
// @name            redirector.uc.js
// @namespace       redirector@haoutil.com
// @description     Redirect your requests.
// @include         chrome://browser/content/browser.xul
// @author          harv.c
// @homepage        http://haoutil.com
// @version         1.4.5
// ==/UserScript==
(function() {
    Cu.import("resource://gre/modules/XPCOMUtils.jsm");
    Cu.import("resource://gre/modules/Services.jsm");
    Cu.import("resource://gre/modules/NetUtil.jsm");
    function Redirector() {
        this.rules = [{
            from: "about:haoutil",                  // 需要重定向的地址
            to: "https://haoutil.googlecode.com",   // 目标地址
                                                    // 支持函数(function(matches){}),返回必须是字符串
                                                    // 参数 matches: 正则,匹配结果数组(match函数结果); 通配符,整个网址和(*)符号匹配结果组成的数组; 字符串,整个网址
            wildcard: false,                        // 可选，true 表示 from 是通配符
            regex: false,                           // 可选，true 表示 from 是正则表达式
            resp: false                             // 可选，true 表示替换 response body
        },{
            // google链接加密
            from: /^http:\/\/(([^\.]+\.)?google\..+)/i,
            exclude: /google\.cn/i,                 // 可选，排除例外规则
            to: "https://$1",
            regex: true
        },{
            // google搜索结果禁止跳转
            from: /^https?:\/\/www\.google\.com\/url\?.*url=([^&]*).*/i,
            to: "$1",
            regex: true
        }];
    }
    Redirector.prototype = {
        _cache: {
            redirectUrl: {},
            clickUrl: {}
        },
        classDescription: "Redirector content policy",
        classID: Components.ID("{1d5903f0-6b5b-4229-8673-76b4048c6675}"),
        contractID: "@haoutil.com/redirector/policy;1",
        xpcom_categories: ["content-policy", "net-channel-event-sinks"],
        init: function() {
            window.addEventListener("click", this, false);
            let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
            registrar.registerFactory(this.classID, this.classDescription, this.contractID, this);
            let catMan = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
            for each (let category in this.xpcom_categories)
                catMan.addCategoryEntry(category, this.classDescription, this.contractID, false, true);
            Services.obs.addObserver(this, "http-on-modify-request", false);
            Services.obs.addObserver(this, "http-on-examine-response", false);
        },
        destroy: function() {
            window.removeEventListener("click", this, false);
            let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
            registrar.unregisterFactory(this.classID, this);
            let catMan = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
            for each (let category in this.xpcom_categories)
                catMan.deleteCategoryEntry(category, this.classDescription, false);
            Services.obs.removeObserver(this, "http-on-modify-request", false);
            Services.obs.removeObserver(this, "http-on-examine-response", false);
        },
        getRedirectUrl: function(originUrl) {
            let url;
            try {
                url = decodeURIComponent(originUrl);
            } catch(e) {
                url = originUrl;
            }
            let redirectUrl = this._cache.redirectUrl[url];
            if(typeof redirectUrl != "undefined") {
                return redirectUrl;
            }
            redirectUrl = null;
            for each (let rule in this.rules) {
                let regex, from, to, exclude;
                if (rule.computed) {
                    regex = rule.computed.regex; from = rule.computed.from; to = rule.computed.to; exclude = rule.computed.exclude;
                } else {
                    regex = false; from = rule.from; to = rule.to; exclude = rule.exclude;
                    if (rule.wildcard) {
                        regex = true;
                        from = this.wildcardToRegex(rule.from);
                        exclude = this.wildcardToRegex(rule.exclude);
                    } else if (rule.regex) {
                        regex = true;
                    }
                    rule.computed = {regex: regex, from: from, to: to, exclude: exclude};
                }
                let redirect = regex
                    ? from.test(url) ? !(exclude && exclude.test(url)) : false
                    : from == url ? !(exclude && exclude == url) : false;
                if (redirect) {
                    redirectUrl = {
                        url : typeof to == "function"
                            ? regex ? to(url.match(from)) : to(from)
                            : regex ? url.replace(from, to) : to,
                        resp: rule.resp
                    };
                    break;
                }
            }
            this._cache.redirectUrl[url] = redirectUrl;
            return redirectUrl;
        },
        wildcardToRegex: function(wildcard) {
            return new RegExp((wildcard + "").replace(new RegExp("[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\-]", "g"), "\\$&").replace(/\\\*/g, "(.*)").replace(/\\\?/g, "."), "i");
        },
        getTarget: function(redirectUrl, callback) {
            NetUtil.asyncFetch(redirectUrl.url, function(inputStream, status) {
                let binaryOutputStream = Cc['@mozilla.org/binaryoutputstream;1'].createInstance(Ci['nsIBinaryOutputStream']);
                let storageStream = Cc['@mozilla.org/storagestream;1'].createInstance(Ci['nsIStorageStream']);
                let count = inputStream.available();
                let data = NetUtil.readInputStreamToString(inputStream, count);
                storageStream.init(512, count, null);
                binaryOutputStream.setOutputStream(storageStream.getOutputStream(0));
                binaryOutputStream.writeBytes(data, count);
                redirectUrl.storageStream = storageStream;
                redirectUrl.count = count;
                if (typeof callback === 'function')
                    callback();
            });
        },
        // nsIDOMEventListener interface implementation
        handleEvent: function(event) {
            if (!event.ctrlKey && "click" === event.type && 1 === event.which) {
                let target = event.target;
                while(target) {
                    if (target.tagName && "BODY" === target.tagName.toUpperCase()) break;
                    if (target.tagName && "A" === target.tagName.toUpperCase()
                        && target.target && "_BLANK" === target.target.toUpperCase()
                        && target.href) {
                        this._cache.clickUrl[target.href] = true;
                        break;
                    }
                    target = target.parentNode;
                }
            }
        },
        // nsIContentPolicy interface implementation
        shouldLoad: function(contentType, contentLocation, requestOrigin, context, mimeTypeGuess, extra) {
            // don't redirect clicking links with "_blank" target attribute
            // cause links will be loaded in current tab/window
            if (this._cache.clickUrl[contentLocation.spec]) {
                delete this._cache.clickUrl[contentLocation.spec];
                return Ci.nsIContentPolicy.ACCEPT;
            }
            // only redirect documents
            if (contentType != Ci.nsIContentPolicy.TYPE_DOCUMENT)
                return Ci.nsIContentPolicy.ACCEPT;
            if (!context || !context.loadURI)
                return Ci.nsIContentPolicy.ACCEPT;
            let redirectUrl = this.getRedirectUrl(contentLocation.spec);
            if (redirectUrl && !redirectUrl.resp) {
                context.loadURI(redirectUrl.url, requestOrigin, null);
                return Ci.nsIContentPolicy.REJECT_REQUEST;
            }
            return Ci.nsIContentPolicy.ACCEPT;
        },
        shouldProcess: function(contentType, contentLocation, requestOrigin, context, mimeTypeGuess, extra) {
            return Ci.nsIContentPolicy.ACCEPT;
        },
        // nsIChannelEventSink interface implementation
        asyncOnChannelRedirect: function(oldChannel, newChannel, flags, redirectCallback) {
            this.onChannelRedirect(oldChannel, newChannel, flags);
            redirectCallback.onRedirectVerifyCallback(Cr.NS_OK);
        },
        onChannelRedirect: function(oldChannel, newChannel, flags) {
            // only redirect documents
            if (!(newChannel.loadFlags & Ci.nsIChannel.LOAD_DOCUMENT_URI))
                return;
            let newLocation = newChannel.URI.spec;
            if (!newLocation)
                return;
            let callbacks = [];
            if (newChannel.notificationCallbacks)
                callbacks.push(newChannel.notificationCallbacks);
            if (newChannel.loadGroup && newChannel.loadGroup.notificationCallbacks)
                callbacks.push(newChannel.loadGroup.notificationCallbacks);
            let win, webNav;
            for each (let callback in callbacks) {
                try {
                    win = callback.getInterface(Ci.nsILoadContext).associatedWindow;
                    webNav = win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation);
                    break;
                } catch(e) {}
            }
            if (!webNav)
                return;
            let redirectUrl = this.getRedirectUrl(newLocation);
            if (redirectUrl && !redirectUrl.resp) {
                webNav.loadURI(redirectUrl.url, null, null, null, null);
            }
        },
        // nsIObserver interface implementation
        observe: function(subject, topic, data, additional) {
            switch (topic) {
                case "http-on-modify-request": {
                    let http = subject.QueryInterface(Ci.nsIHttpChannel);
                    let redirectUrl = this.getRedirectUrl(http.URI.spec);
                    if (redirectUrl && !redirectUrl.resp)
                        if(http.redirectTo)
                            // firefox 20+
                            http.redirectTo(Services.io.newURI(redirectUrl.url, null, null));
                        else
                            // others replace response body
                            redirectUrl.resp = true;
                    break;
                }
                case "http-on-examine-response": {
                    let http = subject.QueryInterface(Ci.nsIHttpChannel);
                    let redirectUrl = this.getRedirectUrl(http.URI.spec);
                    if (redirectUrl && redirectUrl.resp) {
                        if(!http.redirectTo)
                            redirectUrl.resp = false;
                        if (!redirectUrl.storageStream || !redirectUrl.count) {
                            http.suspend();
                            this.getTarget(redirectUrl, function() {
                                http.resume();
                            });
                        }
                        let newListener = new TrackingListener();
                        subject.QueryInterface(Ci.nsITraceableChannel);
                        newListener.originalListener = subject.setNewListener(newListener);
                        newListener.redirectUrl = redirectUrl;
                    }
                    break;
                }
            }
        },
        // nsIFactory interface implementation
        createInstance: function(outer, iid) {
            if (outer)
                throw Cr.NS_ERROR_NO_AGGREGATION;
            return this.QueryInterface(iid);
        },
        // nsISupports interface implementation
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPolicy, Ci.nsIChannelEventSink, Ci.nsIObserver, Ci.nsIFactory, Ci.nsISupports])
    };
    function TrackingListener() {
        this.originalListener = null;
        this.redirectUrl = null;
    }
    TrackingListener.prototype = {
        // nsITraceableChannel interface implementation
        onStartRequest: function(request, context) {
            this.originalListener.onStartRequest(request, context);
        },
        onStopRequest: function(request, context) {
            this.originalListener.onStopRequest(request, context, Cr.NS_OK);
        },
        onDataAvailable: function(request, context) {
            this.originalListener.onDataAvailable(request, context, this.redirectUrl.storageStream.newInputStream(0), 0, this.redirectUrl.count);
        },
        // nsISupports interface implementation
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIStreamListener, Ci.nsISupports])
    };
    
    var r = null;
    if(location == 'chrome://browser/content/browser.xul') {
        if (!r)
            r = new Redirector();
        r.init();
    }
    window.addEventListener('unload', function() {
        if(location == 'chrome://browser/content/browser.xul') {
            if (r)
                r.destroy();
        }
    });
})();
