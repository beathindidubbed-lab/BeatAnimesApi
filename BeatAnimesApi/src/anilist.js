function anilistSearchQuery(query, page, perPage = 10, type = "ANIME") {
    return `query ($page: Int = ${page}, $id: Int, $type: MediaType = ${type}, $search: String = \"${query}\", $isAdult: Boolean = false, $size: Int = ${perPage}) { 
        Page(page: $page, perPage: $size) { 
            pageInfo { 
                total 
                perPage 
                currentPage 
                lastPage 
                hasNextPage 
            } 
            media(id: $id, type: $type, search: $search, isAdult: $isAdult) { 
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
            } 
        } 
    }`;
}

function anilistTrendingQuery(page = 1, perPage = 10, type = "ANIME") {
    return `query ($page: Int = ${page}, $id: Int, $type: MediaType = ${type}, $isAdult: Boolean = false, $size: Int = ${perPage}, $sort: [MediaSort] = [TRENDING_DESC, POPULARITY_DESC]) { 
        Page(page: $page, perPage: $size) { 
            pageInfo { 
                total 
                perPage 
                currentPage 
                lastPage 
                hasNextPage 
            } 
            media(id: $id, type: $type, isAdult: $isAdult, sort: $sort) { 
                id 
                status(version: 2) 
                title { 
                    userPreferred 
                    romaji 
                    english 
                    native 
                } 
                genres 
                description 
                format 
                bannerImage 
                coverImage { 
                    extraLarge 
                    large 
                    medium 
                    color 
                } 
                episodes 
                meanScore 
                season 
                seasonYear 
                averageScore 
            } 
        } 
    }`;
}

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
                            bannerImage
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

async function searchAnilist(animeName) {
    const cacheKey = animeName.toLowerCase().trim();
    
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                id
                title { romaji english native }
                coverImage { large medium }
                bannerImage
                description
                genres
                averageScore
                status
                episodes
                season
                seasonYear
                format
            }
        }
    `;

    try {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                variables: { search: animeName }
            })
        });

        const data = await response.json();
        
        if (data.data && data.data.Media) {
            const anime = data.data.Media;
            
            return {
                title: anime.title.english || anime.title.romaji,
                titleRomaji: anime.title.romaji,
                titleNative: anime.title.native,
                image: anime.coverImage.large,
                banner: anime.bannerImage,
                description: anime.description?.replace(/<[^>]*>/g, '') || 'No description available',
                genres: anime.genres || [],
                score: anime.averageScore,
                status: anime.status,
                totalEpisodes: anime.episodes,
                season: anime.season,
                year: anime.seasonYear,
                format: anime.format || 'TV'
            };
        }
        
        return null;
    } catch (error) {
        console.error(`Anilist error:`, error.message);
        return null;
    }
}

export {
    anilistSearchQuery,
    anilistTrendingQuery,
    anilistMediaDetailQuery,
    searchAnilist
};
