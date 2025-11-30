function anilistSearchQuery(query, page, perPage = 10, type = "ANIME") {
    return `query ($page: Int = ${page}, $id: Int, $type: MediaType = ${type}, $search: String = \"${query}\", $isAdult: Boolean = false, $size: Int = ${perPage}) { Page(page: $page, perPage: $size) { pageInfo { total perPage currentPage lastPage hasNextPage } media(id: $id, type: $type, search: $search, isAdult: $isAdult) { id status(version: 2) title { userPreferred romaji english native } bannerImage popularity coverImage{ extraLarge large medium color } episodes format season description seasonYear averageScore genres  } } }`;
}

function anilistTrendingQuery(page = 1, perPage = 10, type = "ANIME") {
    return `query ($page: Int = ${page}, $id: Int, $type: MediaType = ${type}, $isAdult: Boolean = false, $size: Int = ${perPage}, $sort: [MediaSort] = [TRENDING_DESC, POPULARITY_DESC]) { Page(page: $page, perPage: $size) { pageInfo { total perPage currentPage lastPage hasNextPage } media(id: $id, type: $type, isAdult: $isAdult, sort: $sort) { id status(version: 2) title { userPreferred romaji english native } genres description format bannerImage coverImage{ extraLarge large medium color } episodes meanScore season seasonYear averageScore } } }`;
}

// ✅ FIXED: Corrected GraphQL query for media details
function anilistMediaDetailQuery(id) {
    return `query ($id: Int = ${id}) { 
        Media(id: $id) { 
            id 
            status(version: 2) 
            title { 
                userPreferred 
                romaji 
                english 
                native 
            } 
            bannerImage 
            popularity 
            coverImage { 
                extraLarge 
                large 
                medium 
                color 
            } 
            episodes 
            format 
            season 
            description 
            seasonYear 
            averageScore 
            genres 
            recommendations { 
                edges { 
                    node { 
                        mediaRecommendation {
                            id 
                            status(version: 2) 
                            title { 
                                userPreferred 
                                romaji 
                                english 
                                native 
                            } 
                            coverImage { 
                                extraLarge 
                                large 
                                medium 
                                color 
                            }
                            format
                            episodes
                            averageScore
                            meanScore
                        }
                    } 
                } 
            } 
        } 
    }`;
}

function anilistUpcomingQuery(page = 1, perPage = 10, type = "ANIME") {
    const year = new Date().getFullYear();
    return `query ($page: Int = ${page}, $id: Int, $type: MediaType = ${type}, $isAdult: Boolean = false, $size: Int = ${perPage}, $sort: [MediaSort] = [POPULARITY_DESC], $season: MediaSeason = WINTER) { Page(page: $page, perPage: $size) { pageInfo { total perPage currentPage lastPage hasNextPage } media(id: $id, type: $type, isAdult: $isAdult, sort: $sort, season: $season, seasonYear: ${year}) { id status(version: 2) title { userPreferred romaji english native } genres description format bannerImage coverImage{ extraLarge large medium color } episodes meanScore season seasonYear averageScore } } }`;
}

function getCurrentSeason() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "SPRING";
    if (month >= 5 && month <= 7) return "SUMMER";
    if (month >= 8 && month <= 10) return "FALL";
    return "WINTER";
}

async function getAnilistTrending(page = 1, perPage = 10) {
    const url = "https://graphql.anilist.co";
    const query = anilistTrendingQuery(page, perPage);
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query: query }),
    };
    const res = await fetch(url, options);
    const data = await res.json();
    
    if (!data || !data.data || !data.data.Page) {
        console.error("Anilist Trending Fetch Failed:", data?.errors || "Unknown Error");
        return { pageInfo: {}, media: [] };
    }

    return data["data"]["Page"];
}

async function getAnilistUpcoming(page = 1, perPage = 10) {
    const url = "https://graphql.anilist.co";
    const query = anilistUpcomingQuery(page, perPage).replace("WINTER", getCurrentSeason());
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query: query }),
    };
    const res = await fetch(url, options);
    const data = await res.json();
    
    if (!data || !data.data || !data.data.Page) {
        console.error("Anilist Upcoming Fetch Failed:", data?.errors || "Unknown Error");
        return { pageInfo: {}, media: [] };
    }

    return data["data"]["Page"];
}

async function getAnilistSearch(query) {
    const url = "https://graphql.anilist.co";
    query = anilistSearchQuery(query, 1, 1);
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query: query }),
    };
    const res = await fetch(url, options);
    let data = await res.json();
    
    if (!data || !data.data || !data.data.Page) {
        console.error("Anilist Search Fetch Failed:", data?.errors || "Unknown Error");
        return { results: [] };
    }
    
    data = { results: data["data"]["Page"]["media"] };
    return data;
}

async function getAnilistAnime(id) {
    const url = "https://graphql.anilist.co";
    console.log(id);
    const query = anilistMediaDetailQuery(id);
    console.log(query);
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query: query }),
    };
    const res = await fetch(url, options);
    let data = await res.json();
    
    if (!data || !data.data || !data.data.Media) {
        console.error("Anilist Media Detail Fetch Failed:", data?.errors || "Unknown Error");
        throw new Error("Failed to fetch anime details from Anilist.");
    }
    
    let results = data["data"]["Media"];
    
    // ✅ FIXED: Proper extraction of recommendations
    if (results["recommendations"] && results["recommendations"]["edges"]) {
        results["recommendations"] = results["recommendations"]["edges"]
            .map(edge => edge.node?.mediaRecommendation)
            .filter(rec => rec !== null && rec !== undefined);
    } else {
        results["recommendations"] = [];
    }

    return results;
}

export {
    getAnilistTrending,
    getAnilistSearch,
    getAnilistAnime,
    getAnilistUpcoming,
};
