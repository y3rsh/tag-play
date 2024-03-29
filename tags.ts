import { getOctokit } from '@actions/github';
import * as core from '@actions/core';

let octokitSingleton: ReturnType<typeof getOctokit>;

interface Tag {
    name: string;
    commit: {
        sha: string;
        url: string;
    };
    zipball_url: string;
    tarball_url: string;
    node_id: string;
}

interface TagDetails {
    name: string;
    date: string;
    sha: string;
}

function getOctokitSingleton() {
    if (!octokitSingleton) {
        const githubToken = process.env.GT;
        if (!githubToken) {
            throw new Error('GitHub token not found');
        }
        octokitSingleton = getOctokit(githubToken);
    }
    return octokitSingleton;
}

async function getAllTags(owner: string, repo: string, fetchAll: boolean = false, per_page: number = 100): Promise<Tag[]> {
    const octokit = getOctokitSingleton();
    let allTags: Tag[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        // console.log(`Fetching page ${page} with ${per_page} tags per page...`); // Debug log
        const response = await octokit.rest.repos.listTags({
            owner,
            repo,
            per_page,
            page,
        });

        if (response.data.length > 0) {
            // console.log(`Fetched ${response.data.length} tags on page ${page}.`); // Debug log
            allTags = allTags.concat(response.data);
            page++;
            hasMore = fetchAll && response.data.length === per_page;
        } else {
            // console.log(`No more tags found on page ${page}.`); // Debug log
            hasMore = false;
        }
    }

    console.log(`Total tags fetched: ${allTags.length}`); // Debug log
    return allTags;
}



async function fetchTagDetails(tag: Tag): Promise<TagDetails> {
    const octokit = getOctokitSingleton();

    try {
        const { data: commitObj } = await octokit.rest.repos.getCommit({
            owner: 'Opentrons',
            repo: 'opentrons',
            ref: tag.commit.sha,
        });
        return {
            name: tag.name,
            date: commitObj.commit.author?.date || '2007-10-29T02:42:39.000-07:00',
            sha: tag.commit.sha,
        };
    } catch (error) {
        core.error(`Failed to fetch commit for tag ${tag.name}: ${error}`);
        throw error;
    }
}


async function main() {
    try {
        const allTags = await getAllTags('Opentrons', 'opentrons', true);
        const tagCategories = ['ot3', 'v', 'docs', 'components', 'protocol-designer'];
        let filteredTags: Tag[] = [];

        for (const category of tagCategories) {
            // Filter tags for the current category and take the first 10
            const firstTags = allTags
                .filter(tag => tag.name.startsWith(category))

            // Print the first 10 tags for the current category
            // console.log(`First ${categorySize} Tags for category '${category}':`);
            // firstTags.forEach(tag => console.log(`${tag.name} - SHA: ${tag.commit.sha}`));
            // console.log('-------------------');
            firstTags.forEach(tag => filteredTags.push(tag));
        }

        // Fetch tag details for filtered tags
        const tagDetailsPromises = filteredTags.map(tag => fetchTagDetails(tag));
        let tagDetails = await Promise.all(tagDetailsPromises);

        // Step 3: Group the sorted tag details by SHA
        const tagsBySha: { [sha: string]: TagDetails[] } = {};
        tagDetails.forEach(tag => {
            if (!tagsBySha[tag.sha]) {
                tagsBySha[tag.sha] = [];
            }
            tagsBySha[tag.sha].push(tag);
        });

        // Convert the object into an array of { sha, tags } to sort by date
        const shaGroups = Object.keys(tagsBySha).map(sha => ({
            sha,
            tags: tagsBySha[sha],
            date: tagsBySha[sha][0].date // Use the date of the first tag in the group
        }));

        // Sort SHA groups by date in descending order (newest first)
        shaGroups.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const latestShaGroupsByCategory: { [category: string]: typeof shaGroups[number] } = {};

        // Categorize SHA groups and find the latest group for each category
        shaGroups.forEach(group => {
            const category = tagCategories.find(category => group.tags[0].name.startsWith(category));
            if (category && (!latestShaGroupsByCategory[category] || new Date(group.date) > new Date(latestShaGroupsByCategory[category].date))) {
                latestShaGroupsByCategory[category] = group;
            }
        });

        // Print the latest SHA group for each category
        Object.entries(latestShaGroupsByCategory).forEach(([category, group]) => {
            console.log(`Latest SHA Group for category '${category}': SHA: ${group.sha} - Date: ${group.date}`);
            group.tags.forEach(tag => {
                console.log(`- ${tag.name} - SHA: ${tag.sha}`);
            });
            console.log('-------------------');
        });
    } catch (error) {
        core.error(`Error fetching tags: ${error}`);
    }
}


main();
