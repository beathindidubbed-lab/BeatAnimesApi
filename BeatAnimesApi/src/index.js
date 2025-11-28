import http from "http";
import { URL } from "url";

import {
    getSearch,
    getAnime,
    getRecentAnime,
    getPopularAnime,
    getEpisode,
    GogoDLScrapper,
    getGogoAuthKey,
} from "./gogo.js";

import {
    getAnilistTrending,
    getAnilistSearch,
    getAnilistAnime,
    getAnilistUpcoming,
} from "./anilist.js";
import { SaveError } from "./errorHandler.js";
import { increaseViews } from "./statsHandler.js";

let CACHE = {};
let HOME_CACHE = {};
let ANIME_CACHE = {};
let SEARCH_CACHE = {};
let REC_CACHE = {};
let RECENT_CACHE = {};
let GP_CACHE = {};
let AT_CACHE = {};

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// Render automatically sets PORT. Use 8000 as fallback for local testing
const PORT = process.env.PORT || 8000;

// Create HTTP server
http.createServer(async (req, res) => {
    let responseBody = "";
    let statusCode = 200;
    let contentType = "application/json";

    try {
        const fullUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = fullUrl.pathname;

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            res.writeHead(204, corsHeaders);
            res.end();
            return;
        }

        // Create Headers object for compatibility
        const headers = new Map();
        Object.entries(req.headers).forEach(([key, value]) => {
            headers.set(key, value);
        });
        const requestHeaders = {
            get: (key) => headers.get(key.toLowerCase()) || null
        };

        // Route handling
        if (pathname.startsWith("/search/")) {
            await increaseViews(requestHeaders);

            let query, page;
            try {
                if (fullUrl.search.includes("page=")) {
                    query = pathname.split("/search/")[1];
                    page = fullUrl.searchParams.get("page") || 1;
                } else {
                    query = pathname.split("/search/")[1];
                    page = 1;
                }
            } catch (err) {
                query = pathname.split("/search/")[1];
                page = 1;
            }

            const cacheKey = query + page.toString();
            if (SEARCH_CACHE[cacheKey] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = SEARCH_CACHE[`time_${cacheKey}`];
                if (t1 - t2 < 60 * 60) {
                    responseBody = JSON.stringify({
                        results: SEARCH_CACHE[cacheKey],
                    });
                }
            }

            if (!responseBody) {
                const data = await getSearch(query, page);
                if (data.length == 0) {
                    throw new Error("Not found");
                }
                SEARCH_CACHE[cacheKey] = data;
                SEARCH_CACHE[`time_${cacheKey}`] = Math.floor(Date.now() / 1000);
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname === "/home") {
            await increaseViews(requestHeaders);

            if (HOME_CACHE["data"] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = HOME_CACHE["time"];
                if (t1 - t2 < 60 * 60) {
                    responseBody = JSON.stringify({
                        results: HOME_CACHE["data"],
                    });
                }
            }

            if (!responseBody) {
                let anilistTrending = [];
                let gogoPopular = [];
                try {
                    anilistTrending = (await getAnilistTrending())["results"];
                } catch (err) {
                    console.error("Anilist trending error:", err);
                    anilistTrending = [];
                }
                try {
                    gogoPopular = await getPopularAnime();
                } catch (err) {
                    console.error("Gogo popular error:", err);
                    gogoPopular = [];
                }
                const data = { anilistTrending, gogoPopular };

                if ((anilistTrending.length == 0) && (gogoPopular.length == 0)) {
                    throw new Error("Something went wrong!");
                }
                if ((anilistTrending.length != 0) && (gogoPopular.length != 0)) {
                    HOME_CACHE["data"] = data;
                    HOME_CACHE["time"] = Math.floor(Date.now() / 1000);
                }
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/anime/")) {
            await increaseViews(requestHeaders);

            let anime = pathname.split("/anime/")[1];

            if (ANIME_CACHE[anime] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = ANIME_CACHE[`time_${anime}`];
                if (t1 - t2 < 60 * 60) {
                    const data = ANIME_CACHE[anime];
                    data["from_cache"] = true;
                    responseBody = JSON.stringify({ results: data });
                }
            }

            if (!responseBody) {
                let data;
                try {
                    data = await getAnime(anime);
                    if (data.name == "") {
                        throw new Error("Not found");
                    }
                    data.source = "gogoanime";
                } catch (err) {
                    try {
                        const search = await getSearch(anime);
                        anime = search[0].id;
                        data = await getAnime(anime);
                        data.source = "gogoanime";
                    } catch (err2) {
                        const search = await getAnilistSearch(anime);
                        anime = search["results"][0].id;
                        data = await getAnilistAnime(anime);
                        data.source = "anilist";
                    }
                }

                if (Object.keys(data).length === 0) {
                    throw new Error("Not found");
                }
                if (data.episodes && data.episodes.length != 0) {
                    ANIME_CACHE[anime] = data;
                    ANIME_CACHE[`time_${anime}`] = Math.floor(Date.now() / 1000);
                }
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/episode/")) {
            await increaseViews(requestHeaders);

            const id = pathname.split("/episode/")[1];
            const data = await getEpisode(id);
            responseBody = JSON.stringify({ results: data });

        } else if (pathname.startsWith("/download/")) {
            await increaseViews(requestHeaders);

            const query = pathname.split("/download/")[1];
            const timeValue = CACHE["timeValue"];
            const cookieValue = CACHE["cookieValue"];

            let cookie = "";

            if (timeValue != null && cookieValue != null) {
                const currentTimeInSeconds = Math.floor(Date.now() / 1000);
                const timeDiff = currentTimeInSeconds - timeValue;

                if (timeDiff > 10 * 60) {
                    cookie = await getGogoAuthKey();
                    CACHE.cookieValue = cookie;
                    CACHE.timeValue = Math.floor(Date.now() / 1000);
                } else {
                    cookie = cookieValue;
                }
            } else {
                const currentTimeInSeconds = Math.floor(Date.now() / 1000);
                CACHE.timeValue = currentTimeInSeconds;
                cookie = await getGogoAuthKey();
                CACHE.cookieValue = cookie;
            }

            const data = await GogoDLScrapper(query, cookie);
            responseBody = JSON.stringify({ results: data });

        } else if (pathname.startsWith("/recent/")) {
            await increaseViews(requestHeaders);

            const page = pathname.split("/recent/")[1];

            if (RECENT_CACHE[page] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = RECENT_CACHE[`time_${page}`];
                if (t1 - t2 < 5 * 60) {
                    responseBody = JSON.stringify({
                        results: RECENT_CACHE[page],
                    });
                }
            }

            if (!responseBody) {
                const data = await getRecentAnime(page);
                if (data.length == 0) {
                    throw new Error("Not found");
                }
                responseBody = JSON.stringify({ results: data });
                RECENT_CACHE[page] = data;
                RECENT_CACHE[`time_${page}`] = Math.floor(Date.now() / 1000);
            }

        } else if (pathname.startsWith("/recommendations/")) {
            await increaseViews(requestHeaders);

            let query = pathname.split("/recommendations/")[1];

            if (REC_CACHE[query]) {
                responseBody = JSON.stringify({
                    results: REC_CACHE[query],
                });
            }

            if (!responseBody) {
                const search = await getAnilistSearch(query);
                const anime = search["results"][0].id;
                let data = await getAnilistAnime(anime);
                data = data["recommendations"];

                if (data.length == 0) {
                    throw new Error("Not found");
                }

                REC_CACHE[query] = data;
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/gogoPopular/")) {
            await increaseViews(requestHeaders);

            let page = pathname.split("/gogoPopular/")[1];

            if (GP_CACHE[page] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = GP_CACHE[`time_${page}`];
                if (t1 - t2 < 10 * 60) {
                    responseBody = JSON.stringify({
                        results: GP_CACHE[page],
                    });
                }
            }

            if (!responseBody) {
                let data = await getPopularAnime(page, 20);
                GP_CACHE[page] = data;
                GP_CACHE[`time_${page}`] = Math.floor(Date.now() / 1000);
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/upcoming/")) {
            await increaseViews(requestHeaders);

            let page = pathname.split("/upcoming/")[1];

            if (AT_CACHE[page] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = AT_CACHE[`time_${page}`];
                if (t1 - t2 < 60 * 60) {
                    responseBody = JSON.stringify({
                        results: AT_CACHE[page],
                    });
                }
            }

            if (!responseBody) {
                let data = await getAnilistUpcoming(page);
                data = data["results"];
                AT_CACHE[page] = data;
                AT_CACHE[`time_${page}`] = Math.floor(Date.now() / 1000);
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname === "/ping" || pathname === "/") {
            // Health check endpoint
            responseBody = JSON.stringify({ 
                status: "alive", 
                timestamp: Date.now(),
                message: "Beat Animes API is running!"
            });

        } else {
            // Landing page HTML
            contentType = "text/html";
            responseBody = '<!doctype html><html lang=en><meta charset=UTF-8><meta content="width=device-width,initial-scale=1"name=viewport><title>Beat Animes API</title><style>body{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;margin:0;padding:0;background-color:#f8f9fa;color:#495057;line-height:1.6}header{background-color:#343a40;color:#fff;text-align:center;padding:1.5em 0;margin-bottom:1em}h1{margin-bottom:.5em;font-size:2em;color:#17a2b8}p{color:#6c757d;margin-bottom:1.5em}code{background-color:#f3f4f7;padding:.2em .4em;border-radius:4px;font-family:"Courier New",Courier,monospace;color:#495057}.container{margin:1em;padding:1em;background-color:#fff;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}li,ul{list-style:none;padding:0;margin:0}li{margin-bottom:.5em}li code{background-color:#e5e7eb;color:#495057}a{color:#17a2b8;text-decoration:none}a:hover{text-decoration:underline}footer{background-color:#343a40;color:#fff;padding:1em 0;text-align:center}</style><header><h1>Beat Animes API</h1><p>Fast & Free Anime API<p class=support>For support, visit our <a href=https://t.me/Beat_Anime_Discussion target=_blank>Telegram Channel</a>.</header><div class=container><h2>API Routes:</h2><ul><li><code>/home</code> - Get trending anime from Anilist and popular anime from GogoAnime<li><code>/search/{query}</code> - Search for anime by name<li><code>/anime/{id}</code> - Get details of a specific anime<li><code>/episode/{id}</code> - Get episode stream urls<li><code>/download/{id}</code> - Get episode download urls<li><code>/recent/{page}</code> - Get recent animes from gogoanime<li><code>/recommendations/{query}</code> - Get recommendations<li><code>/gogoPopular/{page}</code> - Get popular animes from gogoanime<li><code>/upcoming/{page}</code> - Get upcoming animes from anilist<li><code>/ping</code> - Health check</ul></div><footer><p>© 2024 Beat Animes API. All rights reserved.</footer>';
        }

    } catch (e) {
        console.error("API Error:", e.message, e.stack);
        await SaveError(e.message + " | URL: " + req.url);
        
        statusCode = 500;
        responseBody = JSON.stringify({ 
            error: e.message || "Internal Server Error",
            path: req.url 
        });
    }

    // Send response with CORS headers
    res.writeHead(statusCode, {
        "Content-Type": contentType,
        ...corsHeaders
    });
    res.end(responseBody);

}).listen(PORT, () => {
    console.log(`✅ Beat Animes API is running on port ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
});
