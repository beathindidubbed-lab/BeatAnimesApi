import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import { load } from "cheerio";

// Updated working domains
const GOGO_DOMAINS = [
    "https://anitaku.to",
    "https://gogoanime3.co",
    "https://gogoanime.hu"
];

let BaseURL = GOGO_DOMAINS[0];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithFallback(path, options = {}) {
    let lastError;
    const MAX_RETRIES = 2;
    
    for (const domain of GOGO_DOMAINS) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = domain + path;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                    }
                });
                
                clearTimeout(timeout);

                if (response.ok) {
                    BaseURL = domain; // Set the working domain
                    return response;
                }
                
                // If response is not ok (e.g., 404, 500), throw an error to trigger next retry/domain
                throw new Error(`HTTP Error ${response.status} from ${domain}`);
            } catch (error) {
                lastError = error;
                console.error(`Attempt ${attempt + 1} failed for ${domain}${path}:`, error.message);
                if (attempt < MAX_RETRIES) {
                    await wait(1000); // Wait 1 second before retrying on the same domain
                }
            }
        }
    }
    
    console.error(`All domains failed for path: ${path}`);
    throw new Error(`Failed to fetch from all domains after multiple retries: ${lastError.message}`);
}

async function getSearch(query, page = 1) {
    try {
        const response = await fetchWithFallback(`/search.html?keyword=${query}&page=${page}`);
        const html = await response.text();
        const $ = load(html);
        const data = [];
        let hasNextPage = false;

        $("div.last_episodes > ul > li").each((i, el) => {
            const $el = $(el);
            const animeId = $el.find("a").attr("href").replace("/category/", "");
            const image = $el.find(".img img").attr("src");
            const title = $el.find(".name a").text();
            const released = $el.find(".released").text().trim();

            if (animeId && title) {
                data.push({
                    id: animeId,
                    title: title,
                    image: image,
                    releaseDate: released,
                });
            }
        });

        // Check for next page
        const currentPage = parseInt($(".pagination .selected a").text()) || 1;
        const lastPage = parseInt($(".pagination li:last-child a").text()) || currentPage;
        
        if (currentPage < lastPage) {
            hasNextPage = true;
        }


        return { results: data, hasNextPage };
    } catch (e) {
        console.error("getSearch error:", e.message);
        return { results: [], hasNextPage: false, error: e.message };
    }
}

async function getAnime(animeid) {
    try {
        const response = await fetchWithFallback(`/category/${animeid}`);
        const html = await response.text();
        const $ = load(html);
        
        // Extracting data
        const title = $("div.anime_info_body_bg > h1").text().trim();
        const image = $("div.anime_info_body_bg > img").attr("src");
        const summary = $("div.anime_info_body_bg > p:nth-child(5)").text().replace("Plot Summary: ", "").trim();
        const type = $("div.anime_info_body_bg > p:nth-child(4) > a").text().trim();
        const status = $("div.anime_info_body_bg > p:nth-child(7) > a").text().trim();
        const releaseDate = $("div.anime_info_body_bg > p:nth-child(6)").text().replace("Released: ", "").trim();
        
        const genres = [];
        $("div.anime_info_body_bg > p:nth-child(8) > a").each((i, el) => {
            genres.push($(el).text().trim());
        });
        
        const otherName = $("div.anime_info_body_bg > p:nth-child(9)").text().replace("Other name: ", "").trim();
        
        // Episode list AJAX ID
        const episodeAjaxId = $('#episode_page').find('li').last().find('a').attr('ep_start');

        // Fetch episode list
        const episodes = await getEpisodeList(episodeAjaxId);

        return {
            id: animeid,
            title: title,
            image: image,
            status: status,
            summary: summary,
            genres: genres,
            releaseDate: releaseDate,
            otherName: otherName,
            type: type,
            source: 'gogoanime',
            episodes: episodes,
        };
    } catch (e) {
        console.error(`getAnime error for ID ${animeid}:`, e.message);
        throw new Error("Failed to fetch anime details.");
    }
}

async function getEpisodeList(id, page = 1) {
    try {
        // The endpoint is crucial for getting the list
        // Note: The page parameter is often ignored by the server for gogoanime lists
        const response = await fetchWithFallback(
            `https://ajax.gogocdn.net/ajax/load-list-episode?ep_start=0&ep_end=3000&id=${id}`
        );
        const html = await response.text();
        const $ = load(html);
        const episodes = [];

        // FIX: Updated selector for the AJAX response
        $("li").each((i, el) => {
            const $el = $(el);
            const anchor = $el.find("a"); 
            const href = anchor.attr("href");
            
            if (href && href.includes("-episode-")) {
                const episodeId = href.replace(/^\//, "");
                
                // Extract episode number from the .name span or fallback to parsing the ID
                const epNumText = $el.find(".name").text().replace("EP", "").trim();
                const epNum = epNumText || 
                              episodeId.split("-episode-")[1] || 
                              (i + 1); 

                episodes.push({
                    id: episodeId,
                    episode: epNum.toString(),
                    title: `Episode ${epNum}`,
                    // Get language/type from the .cate span
                    type: $el.find(".cate").text().trim() || "SUB"
                });
            }
        });

        // Return episodes in descending order (newest first)
        return episodes.reverse();

    } catch (e) {
        console.error(`getEpisodeList error for ID ${id}:`, e.message);
        // Do not throw an error here, return empty array to allow anime details to load
        return [];
    }
}


async function getEpisode(episodeid) {
    try {
        const response = await fetchWithFallback(`/${episodeid}`);
        const html = await response.text();
        const $ = load(html);

        // Find the iframe containing the video player (often 'vidstreaming' or 'fembed' etc)
        const iframeSrc = $(".play-video > iframe").attr("src");
        if (!iframeSrc) {
            throw new Error("No video iframe found on the episode page.");
        }

        // The video player URL is usually relative to the base domain
        const playerUrl = iframeSrc.startsWith("http") ? iframeSrc : new URL(iframeSrc, BaseURL).href;
        
        // This regex extracts the ID from the `id=` parameter in the player URL
        const videoIdMatch = playerUrl.match(/[?&]id=([^&]+)/);
        if (!videoIdMatch || !videoIdMatch[1]) {
            throw new Error("Could not extract video ID from player URL.");
        }
        const videoId = videoIdMatch[1];
        
        // Fetch the embedded video player page itself
        const playerResponse = await fetch(playerUrl, { 
            headers: { 
                "User-Agent": USER_AGENT,
                "Referer": BaseURL, // Must include referer for the AJAX key extraction
            } 
        });
        const playerHtml = await playerResponse.text();
        const player$ = load(playerHtml);
        
        // Use the extractor function to get the encrypted parameters
        const encryptedParams = await generateEncryptAjaxParameters(player$, videoId);
        
        // API endpoint for fetching actual video sources
        const apiUrl = new URL("/encrypt-ajax.php?" + encryptedParams, playerUrl).href;

        // Fetch the encrypted sources
        const sourcesResponse = await fetch(apiUrl, {
            headers: {
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": USER_AGENT,
                "Referer": playerUrl, // Must include referer for the AJAX endpoint
            },
        });
        
        const encryptedSources = await sourcesResponse.json();
        
        // Decrypt the response to get the final video sources
        const decryptedData = decryptEncryptAjaxResponse(encryptedSources);

        return {
            sources: decryptedData,
            download: `/download/${episodeid}`, // Use the local download endpoint
        };
    } catch (e) {
        console.error(`getEpisode error for ID ${episodeid}:`, e.message);
        throw new Error("Failed to fetch episode sources.");
    }
}

async function getHome() {
    try {
        const response = await fetchWithFallback(`/`);
        const html = await response.text();
        const $ = load(html);
        const trending = [];
        const recent = [];

        // Scrape Recent Releases (often called 'recent-updates')
        $("div.added_series_body.popular > ul > li").each((i, el) => {
            const $el = $(el);
            const animeId = $el.find("a").attr("href").replace(/^\//, ""); // Removes leading '/'
            const episode = $el.find(".episode").text().trim();
            const title = $el.find(".name").text().trim();
            const image = $el.find("img").attr("src");

            recent.push({
                id: animeId,
                title: title,
                image: image,
                episode: episode,
            });
        });

        // Scrape Trending (often called 'trending')
        $("div.owl-carousel > .item").each((i, el) => {
            const $el = $(el);
            const animeId = $el.find("a").attr("href").replace("/category/", "").trim();
            const title = $el.find(".name").text().trim();
            const image = $el.find(".img img").attr("src");
            const views = $el.find(".views").text().trim();

            trending.push({
                id: animeId,
                title: title,
                image: image,
                views: views,
            });
        });

        return { trending: trending, recent: recent };

    } catch (e) {
        console.error("getHome error:", e.message);
        throw new Error("Failed to fetch GogoAnime home data.");
    }
}

async function getRecentAnime(page = 1) {
    try {
        const response = await fetchWithFallback(`/sub-category/recent-release.html?page=${page}`);
        const html = await response.text();
        const $ = load(html);
        const data = [];
        let hasNextPage = false;

        $("div.last_episodes > ul > li").each((i, el) => {
            const $el = $(el);
            const animeId = $el.find("a").attr("href").replace(/^\//, "");
            const episode = $el.find(".episode").text().trim();
            const title = $el.find(".name a").text();
            const image = $el.find(".img img").attr("src");

            data.push({
                id: animeId,
                title: title,
                image: image,
                episode: episode,
            });
        });
        
        // Check for next page
        const currentPage = parseInt($(".pagination .selected a").text()) || 1;
        const lastPage = parseInt($(".pagination li:last-child a").text()) || currentPage;
        
        if (currentPage < lastPage) {
            hasNextPage = true;
        }

        return { results: data, hasNextPage };
    } catch (e) {
        console.error("getRecentAnime error:", e.message);
        throw new Error("Failed to fetch recent GogoAnime data.");
    }
}

async function getPopularAnime(page = 1) {
    try {
        const response = await fetchWithFallback(`/popular.html?page=${page}`);
        const html = await response.text();
        const $ = load(html);
        const data = [];
        let hasNextPage = false;

        // FIX: Updated selector for the popular list items
        $('div.last_episodes > ul.items > li').each((i, el) => {
            const $el = $(el);
            const animeId = $el.find("a").attr("href").replace("/category/", "");
            const image = $el.find(".img img").attr("src");
            const title = $el.find(".name a").text();
            const released = $el.find(".released").text().trim(); // Selector for release year

            if (animeId && title) {
                data.push({
                    id: animeId,
                    title: title,
                    image: image,
                    releaseDate: released,
                });
            }
        });

        // Check for next page
        const currentPage = parseInt($(".pagination .selected a").text()) || 1;
        const lastPage = parseInt($(".pagination li:last-child a").text()) || currentPage;
        
        if (currentPage < lastPage) {
            hasNextPage = true;
        }

        return { results: data, hasNextPage };

    } catch (e) {
        console.error("getPopularAnime error:", e.message);
        throw new Error("Failed to fetch popular GogoAnime data.");
    }
}

async function GogoDLScrapper(animeid) {
    try {
        const response = await fetchWithFallback("/" + animeid);
        const html = await response.text();
        const $ = load(html);
        
        const data = {};
        $("div.cf-download a").each((i, link) => {
            const $link = $(link);
            const quality = $link.text().trim();
            const url = $link.attr("href");
            if (quality && url) {
                data[quality] = url.trim();
            }
        });
        
        return data;
    } catch (e) {
        console.error("GogoDLScrapper error:", e.message);
        return {};
    }
}

async function getGogoAuthKey() {
    try {
        const response = await fetch(
            "https://api.github.com/repos/TechShreyash/TechShreyash/contents/gogoCookie.txt",
            { headers: { "User-Agent": USER_AGENT } }
        );
        const data = await response.json();
        return data["content"].replaceAll("\n", "");
    } catch (error) {
        console.error("getGogoAuthKey error:", error.message);
        return "";
    }
}

export {
    getSearch,
    getAnime,
    getRecentAnime,
    getPopularAnime,
    getEpisode,
    GogoDLScrapper,
    getGogoAuthKey,
    getHome,
};
