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
// Updated import to match default export
import increaseViews from "./statsHandler.js";

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
        const path = fullUrl.pathname;
        const searchParams = fullUrl.searchParams;

        // Middleware to handle CORs Preflight requests
        if (req.method === "OPTIONS") {
            res.writeHead(204, corsHeaders);
            return res.end();
        }

        // Middleware to track views
        increaseViews(req.headers).catch((e) => console.error("Views tracking failed:", e.message));

        // Router
        if (path === "/ping") {
            responseBody = JSON.stringify({
                status: "ok",
                timestamp: new Date().toISOString(),
            });
        } else if (path === "/home") {
            if (HOME_CACHE.data && HOME_CACHE.expires > Date.now()) {
                responseBody = JSON.stringify(HOME_CACHE.data);
            } else {
                const recent = await getRecentAnime();
                const popular = await getPopularAnime();
                const trending = await getAnilistTrending();
                const upcoming = await getAnilistUpcoming();

                const data = {
                    recent,
                    popular,
                    trending,
                    upcoming
                }
                HOME_CACHE = {
                    data: data,
                    expires: Date.now() + 60 * 60 * 1000, // 1 hour cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/search/")) {
            const query = decodeURIComponent(path.substring(8));
            const page = parseInt(searchParams.get("page")) || 1;

            const cacheKey = `${query}_${page}`;
            if (SEARCH_CACHE[cacheKey] && SEARCH_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(SEARCH_CACHE[cacheKey].data);
            } else {
                const data = await getSearch(query, page);
                SEARCH_CACHE[cacheKey] = {
                    data: data,
                    expires: Date.now() + 30 * 60 * 1000, // 30 minutes cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/anime/")) {
            const animeid = path.substring(7);

            if (ANIME_CACHE[animeid] && ANIME_CACHE[animeid].expires > Date.now()) {
                responseBody = JSON.stringify(ANIME_CACHE[animeid].data);
            } else {
                const data = await getAnime(animeid);
                ANIME_CACHE[animeid] = {
                    data: data,
                    expires: Date.now() + 60 * 60 * 1000, // 1 hour cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/episode/")) {
            const episodeId = path.substring(9);
            const authKey = searchParams.get("authKey") || null; // For GogoDLScrapper later

            if (CACHE[episodeId] && CACHE[episodeId].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[episodeId].data);
            } else {
                const data = await getEpisode(episodeId);
                CACHE[episodeId] = {
                    data: data,
                    expires: Date.now() + 5 * 60 * 1000, // 5 minutes cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/download/")) {
            const episodeId = path.substring(10);
            const authKey = searchParams.get("authKey");

            if (!authKey) {
                throw new Error("Missing 'authKey' query parameter for download.");
            }
            
            if (CACHE[`dl_${episodeId}`] && CACHE[`dl_${episodeId}`].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[`dl_${episodeId}`].data);
            } else {
                const data = await GogoDLScrapper(episodeId, authKey);
                CACHE[`dl_${episodeId}`] = {
                    data: data,
                    expires: Date.now() + 60 * 60 * 1000, // 1 hour cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/recent/")) {
            const page = parseInt(path.substring(8)) || 1;

            if (RECENT_CACHE[page] && RECENT_CACHE[page].expires > Date.now()) {
                responseBody = JSON.stringify(RECENT_CACHE[page].data);
            } else {
                const data = await getRecentAnime(page);
                RECENT_CACHE[page] = {
                    data: data,
                    expires: Date.now() + 15 * 60 * 1000, // 15 minutes cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/recommendations/")) {
            const query = decodeURIComponent(path.substring(17));

            if (REC_CACHE[query] && REC_CACHE[query].expires > Date.now()) {
                responseBody = JSON.stringify(REC_CACHE[query].data);
            } else {
                const anime = await getAnilistSearch(query);
                if (anime.results.length === 0) {
                    throw new Error("Anime not found on Anilist for recommendations.");
                }
                const data = await getAnilistAnime(anime.results[0].id);
                REC_CACHE[query] = {
                    data: data.recommendations,
                    expires: Date.now() + 60 * 60 * 1000, // 1 hour cache
                };
                responseBody = JSON.stringify(data.recommendations);
            }
        } else if (path.startsWith("/gogoPopular/")) {
            const page = parseInt(path.substring(13)) || 1;

            if (GP_CACHE[page] && GP_CACHE[page].expires > Date.now()) {
                responseBody = JSON.stringify(GP_CACHE[page].data);
            } else {
                const data = await getPopularAnime(page);
                GP_CACHE[page] = {
                    data: data,
                    expires: Date.now() + 15 * 60 * 1000, // 15 minutes cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/trending/")) {
            const page = parseInt(path.substring(10)) || 1;

            if (AT_CACHE[page] && AT_CACHE[page].expires > Date.now()) {
                responseBody = JSON.stringify(AT_CACHE[page].data);
            } else {
                const data = await getAnilistTrending(page);
                AT_CACHE[page] = {
                    data: data,
                    expires: Date.now() + 60 * 60 * 1000, // 1 hour cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path.startsWith("/upcoming/")) {
            const page = parseInt(path.substring(10)) || 1;

            const cacheKey = `upcoming_${page}`;
            if (CACHE[cacheKey] && CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[cacheKey].data);
            } else {
                const data = await getAnilistUpcoming(page);
                CACHE[cacheKey] = {
                    data: data,
                    expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours cache
                };
                responseBody = JSON.stringify(data);
            }
        } else if (path === "/authkey") {
            const authKey = await getGogoAuthKey();
            responseBody = JSON.stringify({ authKey: authKey });
        }
        else if (path === "/") {
            contentType = "text/html";
            responseBody = '<style>body { font-family: sans-serif; background-color: #1a202c; color: #e2e8f0; margin: 0; padding: 20px; } .header { text-align: center; margin-bottom: 40px; } .header h1 { color: #63b3ed; } .container { max-width: 800px; margin: 0 auto; background-color: #2d3748; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); margin-bottom: 20px; } .container h2 { border-bottom: 2px solid #4a5568; padding-bottom: 10px; margin-bottom: 15px; color: #90cdf4; } .container ul { list-style: none; padding: 0; } .container li { margin-bottom: 8px; } .container a { color: #63b3ed; text-decoration: none; transition: color 0.2s; } .container a:hover { color: #4299e1; } footer { text-align: center; margin-top: 30px; font-size: 0.8em; color: #a0aec0; }</style><div class=header><h1>Beat Animes API</h1><p>A simple, fast, and cached API for anime data.</p></div><div class=container><h2>Available Endpoints:</h2><ul><li><code>/ping</code> - Health check</li><li><code>/home</code> - Get homepage data (Recent, Popular, Trending, Upcoming)</li><li><code>/search/{query}</code> - Search for anime</li><li><code>/anime/{id}</code> - Get anime details and episode list</li><li><code>/episode/{id}</code> - Get episode streaming URLs</li><li><code>/download/{id}?authKey={key}</code> - Get episode download urls</li><li><code>/recent/{page}</code> - Get recent animes from gogoanime</li><li><code>/recommendations/{query}</code> - Get recommendations</li><li><code>/gogoPopular/{page}</code> - Get popular animes from gogoanime</li><li><code>/trending/{page}</code> - Get trending animes from anilist</li><li><code>/upcoming/{page}</code> - Get upcoming animes from anilist</li><li><code>/authkey</code> - Get the required authKey for download endpoint</li></ul></div><div class=container><h2>Quick Test:</h2><p>Try these endpoints:<ul><li><a href=\"/ping\">GET /ping</a></li><li><a href=\"/home\">GET /home</a></li><li><a href=\"/search/naruto\">GET /search/naruto</a></li><li><a href=\"/recent/1\">GET /recent/1</a></li></ul></div><footer><p>© 2024 Beat Animes API. All rights reserved.</footer>';
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
}).listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
