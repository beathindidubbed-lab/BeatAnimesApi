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
    getHome,
} from "./gogo.js";

import {
    getAnilistTrending,
    getAnilistSearch,
    getAnilistAnime,
    getAnilistUpcoming,
} from "./anilist.js";
import { SaveError } from "./errorHandler.js";
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
        const fullUrl = new URL(req.url, process.env.BASE_URL || "http://localhost:8000");
        const url = fullUrl;
        const path = url.pathname;
        await increaseViews(req.headers).catch(e => console.log('Increase views error', e.message));

        if (path === "/ping") {
            responseBody = JSON.stringify({ message: "API is online!" });
        }

        // ------------------
        // ROUTE: /home (FIXED: Popular fallback logic)
        // ------------------
        else if (path === "/home") {
            const cacheKey = "home";
            if (HOME_CACHE[cacheKey] && HOME_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify({
                    trending: HOME_CACHE[cacheKey].data.anilistTrending,
                    popular: { results: HOME_CACHE[cacheKey].data.gogoPopular },
                    recent: { results: HOME_CACHE[cacheKey].data.gogoRecent },
                    upcoming: HOME_CACHE[cacheKey].data.anilistUpcoming,
                });
                return;
            }

            // Run parallel calls, including dedicated fallbacks for GogoAnime data
            const [gogoHome, anilistTrending, anilistUpcoming, gogoRecentFallback, gogoPopularFallback] = await Promise.allSettled([
                getHome(),
                getAnilistTrending(1, 10),
                getAnilistUpcoming(1, 10),
                getRecentAnime(1),
                getPopularAnime(1)
            ]);

            let gogoRecentData = [];
            // Prioritize recent data from getHome, fallback to getRecentAnime
            if (gogoHome.status === 'fulfilled' && gogoHome.value.recent && gogoHome.value.recent.length > 0) {
                gogoRecentData = gogoHome.value.recent;
            } 
            else if (gogoRecentFallback.status === 'fulfilled' && gogoRecentFallback.value.results) {
                gogoRecentData = gogoRecentFallback.value.results;
            }

            let gogoPopularData = [];
            // Prioritize popular/trending data from getHome, fallback to getPopularAnime
            if (gogoHome.status === 'fulfilled' && gogoHome.value.trending && gogoHome.value.trending.length > 0) {
                gogoPopularData = gogoHome.value.trending;
            } 
            else if (gogoPopularFallback.status === 'fulfilled' && gogoPopularFallback.value.results) {
                gogoPopularData = gogoPopularFallback.value.results;
            }

            const data = {
                anilistTrending: anilistTrending.status === 'fulfilled' ? anilistTrending.value.results : [],
                anilistUpcoming: anilistUpcoming.status === 'fulfilled' ? anilistUpcoming.value.results : [],
                gogoRecent: gogoRecentData, 
                gogoPopular: gogoPopularData,
            };

            HOME_CACHE[cacheKey] = {
                data: data,
                expires: Date.now() + 10 * 60 * 1000,
            };

            const simplifiedData = {
                trending: data.anilistTrending,
                popular: { results: data.gogoPopular },
                recent: { results: data.gogoRecent },
                upcoming: data.anilistUpcoming
            };

            responseBody = JSON.stringify(simplifiedData);
        }

        // ------------------
        // ROUTE: /search/{query} (FIXED: No-results error)
        // ------------------
        else if (path.startsWith("/search/")) {
            const query = url.pathname.replace("/search/", "").trim().split("?")[0];
            const page = parseInt(url.searchParams.get("page")) || 1;
            const cacheKey = `/search/${query}/${page}`;

            if (SEARCH_CACHE[cacheKey] && SEARCH_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(SEARCH_CACHE[cacheKey].data);
                return;
            }

            const data = await getSearch(query, page);
            const searchResults = data.results || [];

            // FIX: If no results found, return a successful status (200 OK) with empty array
            if (searchResults.length === 0) {
                statusCode = 200;
                responseBody = JSON.stringify({ 
                    results: { 
                        results: [], 
                        hasNextPage: false,
                        message: `No results found for "${query}"` 
                    } 
                });
                return;
            } 

            SEARCH_CACHE[cacheKey] = {
                data: { results: data },
                expires: Date.now() + 30 * 60 * 1000,
            };
            responseBody = JSON.stringify({ results: data });
        }
        
        // ------------------
        // ROUTE: /anime/{id}
        // ------------------
        else if (path.startsWith("/anime/")) {
            const animeId = url.pathname.replace("/anime/", "").trim().split("?")[0];
            const cacheKey = `/anime/${animeId}`;

            if (ANIME_CACHE[cacheKey] && ANIME_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(ANIME_CACHE[cacheKey].data);
                return;
            }

            const data = await getAnime(animeId);
            ANIME_CACHE[cacheKey] = {
                data: { results: data },
                expires: Date.now() + 30 * 60 * 1000,
            };
            responseBody = JSON.stringify({ results: data });
        }

        // ------------------
        // ROUTE: /episode/{id}
        // ------------------
        else if (path.startsWith("/episode/")) {
            const episodeId = url.pathname.replace("/episode/", "").trim().split("?")[0];
            const cacheKey = `/episode/${episodeId}`;

            if (CACHE[cacheKey] && CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[cacheKey].data);
                return;
            }

            const data = await getEpisode(episodeId);
            CACHE[cacheKey] = {
                data: { results: data },
                expires: Date.now() + 30 * 60 * 1000,
            };
            responseBody = JSON.stringify({ results: data });
        }
        
        // ------------------
        // ROUTE: /recent/{page}
        // ------------------
        else if (path.startsWith("/recent/")) {
            const page = parseInt(url.pathname.replace("/recent/", "").trim()) || 1;
            const cacheKey = `/recent/${page}`;

            if (RECENT_CACHE[cacheKey] && RECENT_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(RECENT_CACHE[cacheKey].data);
                return;
            }

            const data = await getRecentAnime(page);
            RECENT_CACHE[cacheKey] = {
                data: data,
                expires: Date.now() + 10 * 60 * 1000,
            };
            responseBody = JSON.stringify(data);
        }
        
        // ------------------
        // ROUTE: /popular/{page}
        // ------------------
        else if (path.startsWith("/popular/")) {
            const page = parseInt(url.pathname.replace("/popular/", "").trim()) || 1;
            const cacheKey = `/popular/${page}`;

            if (GP_CACHE[cacheKey] && GP_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(GP_CACHE[cacheKey].data);
                return;
            }

            const data = await getPopularAnime(page);
            GP_CACHE[cacheKey] = {
                data: data,
                expires: Date.now() + 10 * 60 * 1000,
            };
            responseBody = JSON.stringify(data);
        }

        // ------------------
        // ROUTE: /trending
        // ------------------
        else if (path === "/trending") {
            const cacheKey = "/trending";

            if (AT_CACHE[cacheKey] && AT_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(AT_CACHE[cacheKey].data);
                return;
            }

            const data = await getAnilistTrending(1, 20);
            AT_CACHE[cacheKey] = {
                data: data,
                expires: Date.now() + 60 * 60 * 1000,
            };
            responseBody = JSON.stringify(data);
        }

        // ------------------
        // ROUTE: /download/{id}
        // ------------------
        else if (path.startsWith("/download/")) {
            const animeId = url.pathname.replace("/download/", "").trim().split("?")[0];
            const data = await GogoDLScrapper(animeId);
            responseBody = JSON.stringify({ results: data });
        }
        
        // ------------------
        // ROUTE: /authkey
        // ------------------
        else if (path === "/authkey") {
            const data = await getGogoAuthKey();
            responseBody = JSON.stringify({ key: data });
        }

        // ------------------
        // ROUTE: /anilist/search/{query}
        // ------------------
        else if (path.startsWith("/anilist/search/")) {
            const query = url.pathname.replace("/anilist/search/", "").trim().split("?")[0];
            const data = await getAnilistSearch(query);
            responseBody = JSON.stringify(data);
        }
        
        // ------------------
        // ROUTE: /anilist/anime/{id}
        // ------------------
        else if (path.startsWith("/anilist/anime/")) {
            const id = parseInt(url.pathname.replace("/anilist/anime/", "").trim().split("?")[0]);
            const data = await getAnilistAnime(id);
            responseBody = JSON.stringify({ results: data });
        }

        // ------------------
        // ROUTE: /recommendations/{query}
        // ------------------
        else if (path.startsWith("/recommendations/")) {
            const query = url.pathname.replace("/recommendations/", "").trim().split("?")[0];
            const cacheKey = `/recommendations/${query}`;

            if (REC_CACHE[cacheKey] && REC_CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(REC_CACHE[cacheKey].data);
                return;
            }

            const data = await getAnilistSearch(query);
            REC_CACHE[cacheKey] = {
                data: data,
                expires: Date.now() + 60 * 60 * 1000,
            };
            responseBody = JSON.stringify(data);
        }
        
        // ------------------
        // ROUTE: /
        // ------------------
        else if (path === "/") {
            contentType = "text/html";
            responseBody = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Beat Animes API</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #282828; color: #fff; }
        .container { max-width: 900px; margin: 50px auto; padding: 20px; background-color: #1f1f1f; border-radius: 8px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5); }
        h1 { color: #eb3349; border-bottom: 2px solid #eb3349; padding-bottom: 10px; }
        h2 { color: #f45c43; margin-top: 30px; }
        .endpoint { background-color: #333; padding: 10px 15px; border-radius: 4px; margin-bottom: 10px; font-family: 'Consolas', 'Courier New', monospace; }
        .endpoint a { color: #fff; text-decoration: none; word-wrap: break-word; }
        .endpoint:hover { background-color: #444; }
        .endpoints { margin-bottom: 20px; }
        .test-link { display: inline-block; background-color: #666; color: white; padding: 5px 10px; margin-right: 10px; margin-top: 5px; border-radius: 4px; text-decoration: none; }
        .test-link:hover { background-color: #888; }
        footer { margin-top: 40px; border-top: 1px solid #444; padding-top: 20px; text-align: center; font-size: 0.9em; }
        footer p { margin: 5px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Beat Animes API - v1.0.0</h1>
        <p>A fast, cached, and reliable API for Anime data, powered by Gogoanime and Anilist.</p>

        <div class="endpoints">
            <h2>Core Endpoints</h2>
            <div class="endpoint">GET /ping - Check API status</div>
            <div class="endpoint">GET /home - Get trending, popular, recent, and upcoming anime</div>
            <div class="endpoint">GET /search/{query}?page={number} - Search for anime</div>
            <div class="endpoint">GET /anime/{id} - Get anime details (episodes, summary, etc.)</div>
            <div class="endpoint">GET /episode/{id} - Get video links for an episode</div>
        </div>
        
        <div class="endpoints">
            <h2>Gogoanime Endpoints</h2>
            <div class="endpoint">GET /recent/{page} - Get recent releases</div>
            <div class="endpoint">GET /popular/{page} - Get most popular anime</div>
            <div class="endpoint">GET /download/{id} - Get direct download links for an episode</div>
            <div class="endpoint">GET /authkey - Download auth key</div>
        </div>

        <div class="endpoints">
            <h2>Anilist Endpoints</h2>
            <div class="endpoint">GET /trending - Get Anilist's global trending list</div>
            <div class="endpoint">GET /anilist/search/{query} - Search Anilist for titles</div>
            <div class="endpoint">GET /anilist/anime/{id} - Get detailed Anilist data for an anime</div>
            <div class="endpoint">GET /recommendations/{query} - Get recommendations</div>
        </div>

        <div class="endpoints">
            <h2>🧪 Quick Tests</h2>
            <div class="test-links">
                <a href="/ping" class="test-link">Test Ping</a>
                <a href="/home" class="test-link">Test Home</a>
                <a href="/search/naruto" class="test-link">Test Search (Naruto)</a>
                <a href="/recent/1" class="test-link">Test Recent</a>
            </div>
        </div>

        <footer>
            <p>Made with ❤️ by Beat Anime Team</p>
            <p>© 2025 Beat Animes API - All Rights Reserved</p>
        </footer>
    </div>
</body>
</html>`;
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
    console.log(`\n✅ API is listening on port ${PORT}`);
});
