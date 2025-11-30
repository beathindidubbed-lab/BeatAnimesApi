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
        const fullUrl = new URL(req.url, `http://${req.headers.host}`);
        const path = fullUrl.pathname;
        const searchParams = fullUrl.searchParams;

        if (req.method === "OPTIONS") {
            res.writeHead(204, corsHeaders);
            return res.end();
        }

        increaseViews(req.headers).catch((e) => console.error("Views tracking failed:", e.message));

        // Router
        if (path === "/ping") {
            responseBody = JSON.stringify({
                status: "ok",
                timestamp: new Date().toISOString(),
            });
        // ✅ Put these in your index.js - Replace both /home and /anime endpoints

        } else if (path === "/home") {
            if (HOME_CACHE.data && HOME_CACHE.expires > Date.now()) {
                responseBody = JSON.stringify(HOME_CACHE.data);
            } else {
                try {
                    console.log("📡 Fetching home data...");
                    
                    // Fetch from GogoAnime
                    const gogoHome = await getHome();
                    
                    console.log(`✅ GoGo: ${gogoHome.recent.length} recent, ${gogoHome.trending.length} popular`);

                    // Structure response to match frontend expectations
                    const homeData = {
                        results: {
                            popular: gogoHome.trending,   // Array for banner & popular section
                            recent: gogoHome.recent        // Array for recent section
                        }
                    };

                    HOME_CACHE = {
                        data: homeData,
                        expires: Date.now() + 30 * 60 * 1000,
                    };
                    
                    responseBody = JSON.stringify(homeData);
                    
                } catch (error) {
                    console.error("❌ Home API error:", error.message);
                    
                    // Return cached data if available
                    if (HOME_CACHE.data) {
                        console.warn("⚠️ Using expired cache");
                        responseBody = JSON.stringify(HOME_CACHE.data);
                    } else {
                        throw error;
                    }
                }
            }
        } else if (path.startsWith("/anime/")) {
            const animeid = decodeURIComponent(path.substring(7));

            if (ANIME_CACHE[animeid] && ANIME_CACHE[animeid].expires > Date.now()) {
                responseBody = JSON.stringify(ANIME_CACHE[animeid].data);
            } else {
                try {
                    console.log(`📺 Fetching anime: ${animeid}`);
                    const gogoData = await getAnime(animeid);
                    
                    console.log(`✅ GoGo returned ${gogoData.episodes.length} episodes for ${animeid}`);
                    
                    // ✅ FIXED: Return episodes in the format frontend expects
                    // Frontend expects: [[episode_num, episode_id], ...]
                    const episodeArray = gogoData.episodes.map(ep => [
                        ep.episode,  // Episode number (e.g., "1", "2", "3")
                        ep.id        // Episode ID (e.g., "naruto-episode-1")
                    ]);
                    
                    const responseData = {
                        results: {
                            source: "gogoanime",
                            name: gogoData.details.title,
                            image: gogoData.details.image,
                            plot_summary: gogoData.details.synopsis,
                            other_name: gogoData.details.otherName,
                            released: gogoData.details.release,
                            status: gogoData.details.status,
                            genre: gogoData.details.genres.join(", "),
                            type: gogoData.details.type || "TV",
                            episodes: episodeArray  // [[1, "naruto-episode-1"], [2, "naruto-episode-2"], ...]
                        }
                    };
                    
                    ANIME_CACHE[animeid] = {
                        data: responseData,
                        expires: Date.now() + 60 * 60 * 1000,
                    };
                    
                    console.log(`✅ Cached ${animeid} with ${episodeArray.length} episodes`);
                    responseBody = JSON.stringify(responseData);
                } catch (gogoError) {
                    console.warn(`⚠️ Gogo failed for ${animeid}, trying Anilist:`, gogoError.message);
                    
                    // Fallback to Anilist
                    const anilistSearch = await getAnilistSearch(animeid);
                    if (!anilistSearch.results || anilistSearch.results.length === 0) {
                        throw new Error("Anime not found on GogoAnime or Anilist");
                    }
                    
                    const anilistData = await getAnilistAnime(anilistSearch.results[0].id);
                    
                    const responseData = {
                        results: {
                            source: "anilist",
                            ...anilistData,
                            episodes: []  // Anilist doesn't have episode links
                        }
                    };
                    
                    ANIME_CACHE[animeid] = {
                        data: responseData,
                        expires: Date.now() + 60 * 60 * 1000,
                    };
                    responseBody = JSON.stringify(responseData);
                }
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
                    data: { results: data },
                    expires: Date.now() + 30 * 60 * 1000,
                };
                responseBody = JSON.stringify({ results: data });
            }
        
        } else if (path.startsWith("/episode/")) {
            const episodeId = decodeURIComponent(path.substring(9));

            if (CACHE[episodeId] && CACHE[episodeId].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[episodeId].data);
            } else {
                const episodeData = await getEpisode(episodeId);
                
                const responseData = {
                    results: episodeData
                };
                
                CACHE[episodeId] = {
                    data: responseData,
                    expires: Date.now() + 5 * 60 * 1000,
                };
                responseBody = JSON.stringify(responseData);
            }
        } else if (path.startsWith("/download/")) {
            const episodeId = decodeURIComponent(path.substring(10));

            if (CACHE[`dl_${episodeId}`] && CACHE[`dl_${episodeId}`].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[`dl_${episodeId}`].data);
            } else {
                const dlData = await GogoDLScrapper(episodeId);
                
                const responseData = {
                    results: dlData
                };
                
                CACHE[`dl_${episodeId}`] = {
                    data: responseData,
                    expires: Date.now() + 60 * 60 * 1000,
                };
                responseBody = JSON.stringify(responseData);
            }
        } else if (path.startsWith("/recent/")) {
            const page = parseInt(path.substring(8)) || 1;

            if (RECENT_CACHE[page] && RECENT_CACHE[page].expires > Date.now()) {
                responseBody = JSON.stringify(RECENT_CACHE[page].data);
            } else {
                const data = await getRecentAnime(page);
                RECENT_CACHE[page] = {
                    data: { results: data },
                    expires: Date.now() + 15 * 60 * 1000,
                };
                responseBody = JSON.stringify({ results: data });
            }
        } else if (path.startsWith("/recommendations/")) {
            const query = decodeURIComponent(path.substring(17));

            if (REC_CACHE[query] && REC_CACHE[query].expires > Date.now()) {
                responseBody = JSON.stringify(REC_CACHE[query].data);
            } else {
                const searchResult = await getAnilistSearch(query);
                if (!searchResult.results || searchResult.results.length === 0) {
                    throw new Error("Anime not found on Anilist for recommendations.");
                }
                
                const animeData = await getAnilistAnime(searchResult.results[0].id);
                const recommendations = animeData.recommendations || [];
                
                REC_CACHE[query] = {
                    data: { results: recommendations },
                    expires: Date.now() + 60 * 60 * 1000,
                };
                responseBody = JSON.stringify({ results: recommendations });
            }
        } else if (path.startsWith("/gogoPopular/")) {
            const page = parseInt(path.substring(13)) || 1;

            if (GP_CACHE[page] && GP_CACHE[page].expires > Date.now()) {
                responseBody = JSON.stringify(GP_CACHE[page].data);
            } else {
                const data = await getPopularAnime(page);
                GP_CACHE[page] = {
                    data: { results: data },
                    expires: Date.now() + 15 * 60 * 1000,
                };
                responseBody = JSON.stringify({ results: data });
            }
        } else if (path.startsWith("/trending/")) {
            const page = parseInt(path.substring(10)) || 1;

            if (AT_CACHE[page] && AT_CACHE[page].expires > Date.now()) {
                responseBody = JSON.stringify(AT_CACHE[page].data);
            } else {
                const data = await getAnilistTrending(page, 20);
                const responseData = {
                    results: {
                        trending: data.media || []
                    }
                };
                
                AT_CACHE[page] = {
                    data: responseData,
                    expires: Date.now() + 60 * 60 * 1000,
                };
                responseBody = JSON.stringify(responseData);
            }
        } else if (path.startsWith("/upcoming/")) {
            const page = parseInt(path.substring(10)) || 1;

            const cacheKey = `upcoming_${page}`;
            if (CACHE[cacheKey] && CACHE[cacheKey].expires > Date.now()) {
                responseBody = JSON.stringify(CACHE[cacheKey].data);
            } else {
                const data = await getAnilistUpcoming(page, 20);
                const responseData = {
                    results: {
                        upcoming: data.media || []
                    }
                };
                
                CACHE[cacheKey] = {
                    data: responseData,
                    expires: Date.now() + 24 * 60 * 60 * 1000,
                };
                responseBody = JSON.stringify(responseData);
            }
        } else if (path === "/authkey") {
            const authKey = await getGogoAuthKey();
            responseBody = JSON.stringify({ authKey: authKey });
        } else if (path === "/") {
            contentType = "text/html";
            responseBody = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Beat Animes API</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; background: white; border-radius: 20px; padding: 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
        h1 { color: #667eea; font-size: 2.5rem; margin-bottom: 10px; text-align: center; }
        .subtitle { text-align: center; color: #666; margin-bottom: 30px; font-size: 1.1rem; }
        .status { background: #10b981; color: white; padding: 15px; border-radius: 10px; text-align: center; font-weight: bold; margin-bottom: 30px; }
        .endpoints { background: #f8f9fa; padding: 25px; border-radius: 15px; margin-bottom: 25px; }
        .endpoints h2 { color: #333; margin-bottom: 20px; font-size: 1.5rem; }
        .endpoint { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #667eea; font-family: monospace; }
        .endpoint:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateX(5px); transition: all 0.3s; }
        .test-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 20px; }
        .test-link { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; border-radius: 10px; text-decoration: none; text-align: center; font-weight: bold; transition: transform 0.2s; }
        .test-link:hover { transform: scale(1.05); }
        footer { text-align: center; margin-top: 30px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 Beat Animes API</h1>
        <p class="subtitle">High-performance anime streaming data API</p>
        <div class="status">✅ API is Online and Running</div>
        
        <div class="endpoints">
            <h2>📡 Available Endpoints</h2>
            <div class="endpoint">GET /ping - Health check</div>
            <div class="endpoint">GET /home - Homepage data (Trending, Popular, Recent)</div>
            <div class="endpoint">GET /search/{query}?page={page} - Search anime</div>
            <div class="endpoint">GET /anime/{id} - Anime details & episodes</div>
            <div class="endpoint">GET /episode/{id} - Streaming URLs</div>
            <div class="endpoint">GET /download/{id} - Download links</div>
            <div class="endpoint">GET /recent/{page} - Recent releases</div>
            <div class="endpoint">GET /gogoPopular/{page} - Popular anime</div>
            <div class="endpoint">GET /trending/{page} - Trending from Anilist</div>
            <div class="endpoint">GET /upcoming/{page} - Upcoming anime</div>
            <div class="endpoint">GET /recommendations/{query} - Get recommendations</div>
            <div class="endpoint">GET /authkey - Download auth key</div>
        </div>

        <div class="endpoints">
            <h2>🧪 Quick Tests</h2>
            <div class="test-links">
                <a href="/ping" class="test-link">Test Ping</a>
                <a href="/home" class="test-link">Test Home</a>
                <a href="/search/naruto" class="test-link">Test Search</a>
                <a href="/recent/1" class="test-link">Test Recent</a>
            </div>
        </div>

        <footer>
            <p>Made with ❤️ by Beat Anime Team</p>
            <p>© 2024 Beat Animes API - All Rights Reserved</p>
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
    console.log(`✅ Server running at http://localhost:${PORT}`);
});



