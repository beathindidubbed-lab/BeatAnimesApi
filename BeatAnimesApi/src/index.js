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

const PORT = process.env.PORT || 8000;

http.createServer(async (req, res) => {
    let responseBody = "";
    let statusCode = 200;
    let contentType = "application/json";

    try {
        const fullUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = fullUrl.pathname;

        if (req.method === "OPTIONS") {
            res.writeHead(204, corsHeaders);
            res.end();
            return;
        }

        const headers = new Map();
        Object.entries(req.headers).forEach(([key, value]) => {
            headers.set(key, value);
        });
        const requestHeaders = {
            get: (key) => headers.get(key.toLowerCase()) || null
        };

        if (pathname.startsWith("/search/")) {
            await increaseViews(requestHeaders);

            let query, page;
            try {
                query = decodeURIComponent(pathname.split("/search/")[1] || "");
                page = fullUrl.searchParams.get("page") || "1";
            } catch (err) {
                throw new Error("Invalid search query");
            }

            if (!query) {
                throw new Error("Search query is required");
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
                if (!data || data.length == 0) {
                    throw new Error("No results found");
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
                    const anilistData = await getAnilistTrending();
                    anilistTrending = anilistData?.results || [];
                } catch (err) {
                    console.error("Anilist trending error:", err.message);
                }
                
                try {
                    gogoPopular = await getPopularAnime();
                } catch (err) {
                    console.error("Gogo popular error:", err.message);
                }
                
                const data = { anilistTrending, gogoPopular };

                if (anilistTrending.length == 0 && gogoPopular.length == 0) {
                    throw new Error("Unable to fetch anime data");
                }
                
                if (anilistTrending.length > 0 || gogoPopular.length > 0) {
                    HOME_CACHE["data"] = data;
                    HOME_CACHE["time"] = Math.floor(Date.now() / 1000);
                }
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/anime/")) {
            await increaseViews(requestHeaders);

            let anime = decodeURIComponent(pathname.split("/anime/")[1] || "");
            
            if (!anime) {
                throw new Error("Anime ID is required");
            }

            if (ANIME_CACHE[anime] != null) {
                const t1 = Math.floor(Date.now() / 1000);
                const t2 = ANIME_CACHE[`time_${anime}`];
                if (t1 - t2 < 60 * 60) {
                    const data = { ...ANIME_CACHE[anime], from_cache: true };
                    responseBody = JSON.stringify({ results: data });
                }
            }

            if (!responseBody) {
                let data;
                try {
                    data = await getAnime(anime);
                    if (!data || !data.name) {
                        throw new Error("Anime not found");
                    }
                    data.source = "gogoanime";
                } catch (err) {
                    try {
                        const search = await getSearch(anime);
                        if (!search || search.length === 0) {
                            throw new Error("Not found in search");
                        }
                        anime = search[0].id;
                        data = await getAnime(anime);
                        data.source = "gogoanime";
                    } catch (err2) {
                        try {
                            const search = await getAnilistSearch(anime);
                            if (!search?.results || search.results.length === 0) {
                                throw new Error("Not found on Anilist");
                            }
                            anime = search.results[0].id;
                            data = await getAnilistAnime(anime);
                            data.source = "anilist";
                        } catch (err3) {
                            throw new Error("Anime not found anywhere");
                        }
                    }
                }

                if (!data || Object.keys(data).length === 0) {
                    throw new Error("Anime not found");
                }
                
                if (data.episodes && data.episodes.length > 0) {
                    ANIME_CACHE[anime] = data;
                    ANIME_CACHE[`time_${anime}`] = Math.floor(Date.now() / 1000);
                }
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/episode/")) {
            await increaseViews(requestHeaders);

            const id = decodeURIComponent(pathname.split("/episode/")[1] || "");
            if (!id) {
                throw new Error("Episode ID is required");
            }
            
            const data = await getEpisode(id);
            if (!data) {
                throw new Error("Episode not found");
            }
            responseBody = JSON.stringify({ results: data });

        } else if (pathname.startsWith("/download/")) {
            await increaseViews(requestHeaders);

            const query = decodeURIComponent(pathname.split("/download/")[1] || "");
            if (!query) {
                throw new Error("Episode ID is required");
            }

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
                CACHE.timeValue = Math.floor(Date.now() / 1000);
                cookie = await getGogoAuthKey();
                CACHE.cookieValue = cookie;
            }

            const data = await GogoDLScrapper(query, cookie);
            responseBody = JSON.stringify({ results: data });

        } else if (pathname.startsWith("/recent/")) {
            await increaseViews(requestHeaders);

            const page = pathname.split("/recent/")[1] || "1";

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
                if (!data || data.length == 0) {
                    throw new Error("No recent anime found");
                }
                RECENT_CACHE[page] = data;
                RECENT_CACHE[`time_${page}`] = Math.floor(Date.now() / 1000);
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/recommendations/")) {
            await increaseViews(requestHeaders);

            let query = decodeURIComponent(pathname.split("/recommendations/")[1] || "");
            if (!query) {
                throw new Error("Anime name is required");
            }

            if (REC_CACHE[query]) {
                responseBody = JSON.stringify({
                    results: REC_CACHE[query],
                });
            }

            if (!responseBody) {
                const search = await getAnilistSearch(query);
                if (!search?.results || search.results.length === 0) {
                    throw new Error("Anime not found");
                }
                
                const anime = search.results[0].id;
                let data = await getAnilistAnime(anime);
                data = data?.recommendations || [];

                if (data.length == 0) {
                    throw new Error("No recommendations found");
                }

                REC_CACHE[query] = data;
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/gogoPopular/")) {
            await increaseViews(requestHeaders);

            let page = pathname.split("/gogoPopular/")[1] || "1";

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
                if (!data || data.length === 0) {
                    throw new Error("No popular anime found");
                }
                GP_CACHE[page] = data;
                GP_CACHE[`time_${page}`] = Math.floor(Date.now() / 1000);
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname.startsWith("/upcoming/")) {
            await increaseViews(requestHeaders);

            let page = pathname.split("/upcoming/")[1] || "1";

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
                data = data?.results || [];
                if (data.length === 0) {
                    throw new Error("No upcoming anime found");
                }
                AT_CACHE[page] = data;
                AT_CACHE[`time_${page}`] = Math.floor(Date.now() / 1000);
                responseBody = JSON.stringify({ results: data });
            }

        } else if (pathname === "/ping") {
            responseBody = JSON.stringify({ 
                status: "alive", 
                timestamp: Date.now(),
                message: "Beat Animes API is running!"
            });

        } else if (pathname === "/favicon.ico") {
            // Return empty response for favicon requests
            res.writeHead(204, corsHeaders);
            res.end();
            return;

        } else if (pathname === "/") {
            contentType = "text/html";
            responseBody = '<!doctype html><html lang=en><meta charset=UTF-8><meta content="width=device-width,initial-scale=1"name=viewport><title>Beat Animes API</title><style>body{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;margin:0;padding:0;background-color:#f8f9fa;color:#495057;line-height:1.6}header{background-color:#343a40;color:#fff;text-align:center;padding:1.5em 0;margin-bottom:1em}h1{margin-bottom:.5em;font-size:2em;color:#17a2b8}p{color:#6c757d;margin-bottom:1.5em}code{background-color:#f3f4f7;padding:.2em .4em;border-radius:4px;font-family:"Courier New",Courier,monospace;color:#495057}.container{margin:1em;padding:1em;background-color:#fff;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}li,ul{list-style:none;padding:0;margin:0}li{margin-bottom:.5em}li code{background-color:#e5e7eb;color:#495057}a{color:#17a2b8;text-decoration:none}a:hover{text-decoration:underline}footer{background-color:#343a40;color:#fff;padding:1em 0;text-align:center}.status{background:#28a745;color:#fff;padding:.5em 1em;border-radius:4px;display:inline-block;margin:1em 0}</style><header><h1>Beat Animes API</h1><p>Fast & Free Anime API<div class=status>● ONLINE</div><p class=support>For support, visit our <a href=https://t.me/Beat_Anime_Discussion target=_blank>Telegram Channel</a>.</header><div class=container><h2>API Routes:</h2><ul><li><code>/home</code> - Get trending anime from Anilist and popular anime from GogoAnime<li><code>/search/{query}?page={page}</code> - Search for anime by name<li><code>/anime/{id}</code> - Get details of a specific anime<li><code>/episode/{id}</code> - Get episode stream urls<li><code>/download/{id}</code> - Get episode download urls<li><code>/recent/{page}</code> - Get recent animes from gogoanime<li><code>/recommendations/{query}</code> - Get recommendations<li><code>/gogoPopular/{page}</code> - Get popular animes from gogoanime<li><code>/upcoming/{page}</code> - Get upcoming animes from anilist<li><code>/ping</code> - Health check</ul></div><div class=container><h2>Quick Test:</h2><p>Try these endpoints:<ul><li><a href="/ping">GET /ping</a><li><a href="/home">GET /home</a><li><a href="/search/naruto">GET /search/naruto</a><li><a href="/recent/1">GET /recent/1</a></ul></div><footer><p>© 2024 Beat Animes API. All rights reserved.</footer>';
        } else {
            throw new Error("Endpoint not found");
        }

    } catch (e) {
        console.error(`❌ API Error [${req.url}]:`, e.message);
        await SaveError(e.message, req.url).catch(() => {});
        
        statusCode = e.message.includes("not found") ? 404 : 500;
        responseBody = JSON.stringify({ 
            error: e.message || "Internal Server Error",
            path: req.url,
            timestamp: new Date().toISOString()
        });
    }

    res.writeHead(statusCode, {
        "Content-Type": contentType,
        ...corsHeaders
    });
    res.end(responseBody);

}).listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Beat Animes API is running`);
    console.log(`🌐 Port: ${PORT}`);
    console.log(`📡 Ready to accept requests`);
});
