import qs from "querystring";

function generateProxyUri(uri) {
    return `/proxy${uri}`;
}

function generateUrl(r, host, uri, ignoreSpChar) {
    let url = host + uri;
    let isFirst = true;
    for (const key in r.args) {
        // a few players not support special character
        if (ignoreSpChar && (key === "X-Emby-Client" || key === "X-Emby-Device-Name")) {
            continue;
        }
        url += isFirst ? "?" : "&";
        url += `${key}=${r.args[key]}`;
        isFirst = false;
    }
    return url;
}

// 拦截 PlaybackInfo 请求，防止客户端转码（转容器）
async function hijackPlaybackInfo(r) {
    // replay the request
    const proxyUri = generateProxyUri(r.uri);
    r.warn(`PlaybackInfo proxy uri: ${proxyUri}`);
    const query = generateUrl(r, "", "").substring(1);
    r.warn(`PlaybackInfo proxy query string: ${query}`);
    const response = await r.subrequest(proxyUri, {
        method: r.method,
        args: query
    });
    const body = JSON.parse(response.responseText);
    if (
        response.status === 200 &&
        body.MediaSources &&
        body.MediaSources.length > 0
    ) {
        r.log(`main request headersOut: ${JSON.stringify(r.headersOut)}`);
        r.log(`SubRequest headersOut: ${JSON.stringify(response.headersOut)}`);
        r.warn(`origin PlaybackInfo: ${response.responseText}`);
        for (let i = 0; i < body.MediaSources.length; i++) {
            const source = body.MediaSources[i];
            // if (source.IsRemote) {
            //   // live streams are not blocked
            //   // return r.return(200, response.responseText);
            // }
            r.warn(`modify direct play info`);
            source.EnableDirectPlay = true;
            source.SupportsDirectPlay = true;
            source.SupportsDirectStream = true;
            source.OriginDirectStreamUrl = source.DirectStreamUrl; // for debug
            source.DirectStreamUrl = r.variables.externalRedirectUri + '?url=' + encodeURIComponent(source.Path);
            source.SupportsTranscoding = false;
            if (source.TranscodingUrl) {
                delete source.TranscodingUrl;
                delete source.TranscodingSubProtocol;
                delete source.TranscodingContainer;
            }
        }
        for (const key in response.headersOut) {
            if (key === "Content-Length") {
                // auto generate content length
                continue;
            }
            r.headersOut[key] = response.headersOut[key];
        }
        const bodyJson = JSON.stringify(body);
        r.headersOut["Content-Type"] = "application/json;charset=utf-8";
        r.warn(`transfer PlaybackInfo: ${bodyJson}`);
        return r.return(200, bodyJson);
    }
    r.warn("PlaybackInfo SubRequest failed");
    return internalRedirect(r);
}

function internalRedirect(r) {
    r.warn(`use original link`);
    // need caller: return;
    r.internalRedirect(generateProxyUri(r.uri));
}

async function externalRedirect(r) {
    r.warn(r.variables.request_uri.split('?')[1])
    let args = qs.parse(r.variables.request_uri.split('?')[1]);
    r.warn(args.url)
    r.return(302, args.url);
}

export default {
    hijackPlaybackInfo,
    externalRedirect
}