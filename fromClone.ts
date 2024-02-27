import simpleGit, { SimpleGit, LogResult, BranchSummary, DefaultLogFields, TagResult, ListLogLine } from 'simple-git';
import { promises as fs } from 'fs';
import { getOctokit } from '@actions/github';
import { components } from "@octokit/openapi-types";

type PullRequestData = components["schemas"]["pull-request"];

interface RepoConfig {
  url: string;
  localPath: string;
  tagRegex: RegExp;
  releaseBranchPattern?: string;
}

const repoConfigs: RepoConfig[] = [
  {
    url: 'https://github.com/Opentrons/opentrons.git',
    localPath: 'opentrons_repo',
    tagRegex: /^(v|ot3|docs|components|protocol-designer)/,
    releaseBranchPattern: 'chore_release*',
  },
];

async function cloneAndFetch(repoUrl: string, localPath: string): Promise<SimpleGit> {
  if (!await checkDirectoryExists(localPath)) {
    console.log(`Cloning ${repoUrl} into ${localPath}...`);
    await simpleGit().clone(repoUrl, localPath);
    console.log(`Repository cloned to ${localPath}.`);
  }
  const repoGit: SimpleGit = simpleGit(localPath); // Use the specific instance to work with the cloned repo
  console.log('Fetching...');
  await repoGit.fetch(['--all', '--tags', '--prune']);
  console.log('Done fetching.');
  return repoGit;
}

async function checkDirectoryExists(directoryPath: string): Promise<boolean> {
  try {
    await fs.access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

function extractOwnerAndRepo(url: string) {
  const regex = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\.git/;
  const match = url.match(regex);

  if (match) {
    const owner = match[1];
    const repo = match[2];
    return { owner, repo };
  } else {
    throw new Error('Could not parse GitHub URL');
  }
}

let octokitSingleton: ReturnType<typeof getOctokit>;


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

async function fetchPRDetails(owner: string, repo: string, pullNumber: number): Promise<PullRequestData | null> {
  const octokit = getOctokitSingleton()

  try {
    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return prData;
    // Here you can add more logics like extracting JIRA IDs
  } catch (error) {
    console.error(`Error fetching PR details: ${error}`);
  }
  return null;
}

async function printCommitsWithPRAndJiraLinks(repoGit: SimpleGit, pattern: string, repoUrl: string): Promise<void> {

  const { owner, repo } = extractOwnerAndRepo(repoUrl)
  const commits = await repoGit.log({
    '--remotes': `origin/${pattern}`,
    '--pretty': 'format:%H %aI %D %s',
    '--max-count': 100, // Limit the number of commits to 100
  });

  console.log(`\n\nHere are the most recent commits on --remotes origin/${pattern}:`);

  const prRegex = /#(\d+)/;
  const jiraIdRegex = /([a-zA-Z]+-\d{1,5})/gi;
  const jiraLinkRegex = /https:\/\/opentrons\.atlassian\.net\/browse\/([A-Z]+-\d+)/gi
  const jiraBaseUrl = 'https://opentrons.atlassian.net/browse/';
  const repoBaseUrl = repoUrl.replace('.git', '');
  let jiraIds: Set<string> = new Set();
  let jiraLinks: Set<string> = new Set();


  const firstCommit = commits.all[0];
  for (const commit of commits.all) {
    const prMatch = commit.message.match(prRegex);
    let prDataFinal: PullRequestData | null = null;
    if (prMatch) {
      const prNumber = Number(prMatch[1]);
      //

      try {
        const prData: PullRequestData | null = await fetchPRDetails(owner, repo, prNumber);
        if (prData !== null) {
          const prBodyJiraIds = prData.body?.match(jiraIdRegex);
          if (prBodyJiraIds) {
            prBodyJiraIds.forEach((id: string) => jiraIds.add(id.toUpperCase()));
          }
          const prTitleJiraIds = prData.title.match(jiraIdRegex);
          if (prTitleJiraIds) {
            prTitleJiraIds.forEach((id: string) => jiraIds.add(id.toUpperCase()));
          }
          const prBodyJiraLinks = prData.body?.match(jiraLinkRegex);
          if (prBodyJiraLinks) {
            prBodyJiraLinks.forEach((link: string) => jiraLinks.add(link));
          }
          prDataFinal = prData;
        }
      } catch (error) {
        console.error(`Error fetching PR details: ${error}`);
      }
    }
    if (commit.refs && /tag:/.test(commit.refs)) {
      console.log(`\nMost Recent Tag:`)
      console.log(`\n${commit.hash}\n  ${commit.date}\n  ${commit.refs}\n  ${commit.message}`);
      console.log(`  PR Link: ${prDataFinal ? prDataFinal.html_url : 'N/A'}`);
      console.log('_________________________');
      const diffUrl = `${repoBaseUrl}/compare/${commit.hash}...${firstCommit.hash}`;
      console.log(`\nView diff since the last tag:\n  ${diffUrl}`);
      break; // Exit the loop when a tag is found
    } else {
      console.log(`\n${commit.hash}\n  ${commit.date}\n  ${commit.refs}\n  ${commit.message}`);
      console.log(`  PR Link: ${prDataFinal ? prDataFinal.html_url : 'N/A'}`);
    }
  }

  // Deduping and printing Jira links
  // Filter out specific Jira IDs and convert the rest to full URLs
  let filteredAndConvertedJiraLinks = new Set([...jiraIds]
    .filter((id): id is string => !["OT-2", "OT-3"].includes(id)) // Exclude specific IDs
    .map(id => `${jiraBaseUrl}${id}`)); // Convert to URLs

  let combined = new Set([...filteredAndConvertedJiraLinks, ...jiraLinks]);
  console.log('\nHere are the Jira links associated with the commits:');
  combined.forEach(link => {
    console.log(`  Jira Link: ${link}`);
  });
  console.log('\nlet us know if you:')
  console.log('- strongly feel we should cut a new build 🪓');
  console.log('- strongly feel we should wait ⏳');

}

interface TagCommitDetails {
  sha: string;
  date: string; // ISO format for easy sorting
  tags: string[]; // All tags associated with this commit
  message: string;
  authorName: string;
  authorEmail: string;
}


async function fetchRecentTagCommits(repoGit: SimpleGit, maxTags: number = 1000): Promise<TagCommitDetails[]> {
  // Fetch the most recent 200 tags
  const tagsFetch = await repoGit.tags(['--sort=-v:refname']);
  const recentTags = tagsFetch.all.slice(0, maxTags);

  const commitsMap = new Map<string, TagCommitDetails>();

  for (const tagName of recentTags) {
    // Fetch the commit SHA that the tag points to
    const sha = await repoGit.revparse([`${tagName}^{commit}`]);
    const delimiter = '|||';
    // Now fetch the commit details using the SHA
    const format = `%H${delimiter}%aI${delimiter}%an${delimiter}%ae${delimiter}%s`;
    const commitDetails = await repoGit.show(['--no-patch', `--pretty=format:${format}`, sha]);

    // Split details, trim each part, and filter out any empty lines
    const [details, date, authorName, authorEmail, message] = commitDetails.trim().split(delimiter).filter(line => line);

    if (commitsMap.has(sha)) {
      // Append the tag to the tags array for existing commit
      commitsMap.get(sha)?.tags.push(tagName);
    } else {
      // Add new entry to the map for new commit
      commitsMap.set(sha, {
        sha: sha,
        date,
        tags: [tagName],
        message,
        authorName,
        authorEmail,
      });
    }
  }
  return Array.from(commitsMap.values());
}


async function printLast5TagsWithDetails(repoGit: SimpleGit): Promise<void> {
  // Fetch all tags, including their metadata
  const tagsFetch = await repoGit.tags(['--sort=-v:refname']);

  // Get the last 5 tags
  const last5Tags = tagsFetch.all.slice(0, 5);

  console.log('\n--------------TAGS---------------------');
  console.log('Processing the most recent 5 tags:');

  for (const tagName of last5Tags) {
    const format = '%(objecttype)|%(refname:short)|%(taggername)|%(taggeremail)|%(taggerdate:iso-strict)';
    const tagRef = `refs/tags/${tagName}`;
    const tagDetails = await repoGit.raw(['for-each-ref', `--format=${format}`, tagRef]);

    console.log(`\nTag: ${tagName}`);
    if (tagDetails.startsWith('tag')) {
      // Annotated tag, print details
      const [tagType, shortTagName, taggerName, taggerEmail, taggerDate] = tagDetails.split('|');
      console.log(`Tagger: ${taggerName} <${taggerEmail}>`);
      console.log(`Date: ${taggerDate.trimEnd()}`);
      const shortMessage = await repoGit.raw(['tag', '-l', tagName, '--format=%(contents:subject)']);
      console.log(`Message: ${shortMessage.trim()}`);
    } else {
      // Lightweight tag, print as a warning
      console.warn(`Warning: '${tagName}' is a lightweight tag and does not contain additional metadata.`);
    }
  }
}


async function printLatestTagsByCategory(tagCommits: TagCommitDetails[], tagRegex: RegExp): Promise<void> {
  // Initialize a map to hold arrays of the 3 most recent unique commits for each category
  const mostRecentByCategory: Map<string, TagCommitDetails[]> = new Map();

  for (const commit of tagCommits) {
    for (const tag of commit.tags) {
      const match = tag.match(tagRegex);
      if (match) {
        const category = match[0];
        // Get the existing array of commits for this category, or initialize a new one
        let existingCommits = mostRecentByCategory.get(category) || [];

        // Check if this commit is already included in the category
        if (!existingCommits.some(c => c.sha === commit.sha)) {
          // Add the current commit to the array if not already included
          existingCommits = [...existingCommits, commit];
          // Sort the array by date in descending order
          existingCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          // Keep only the 3 most recent commits
          mostRecentByCategory.set(category, existingCommits.slice(0, 3));
        }
      }
    }
  }

  // Print the 3 most recent unique commits for each category
  mostRecentByCategory.forEach((commits, category) => {
    console.log(`\nCategory: ${category}`);
    commits.forEach((commit, index) => {
      console.log(`\nMost Recent Commit #${index + 1}:`);
      console.log(`  SHA: ${commit.sha}`);
      console.log(`  Date: ${commit.date}`);
      console.log(`  Tags: ${commit.tags.join(', ')}`);
      console.log(`  Author: ${commit.authorName} <${commit.authorEmail}>`);
      console.log(`  Message: ${commit.message}`);
    });
  });
}



async function printCommitDetails(repo: SimpleGit, commitSha: string): Promise<void> {
  // Define a pretty format for the commit details
  const format = 'Commit SHA: %H%nAuthor: %an <%ae>%nDate: %ad%nRefs: %D%nMessage: %s';

  // Fetch the commit details without the diff
  const commitDetails = await repo.show([`--no-patch`, `--pretty=format:${format}`, commitSha]);

  // Print the commit details
  console.log(commitDetails);
}


async function main() {
  repoConfigs.forEach(async (config: RepoConfig) => {
    const repo = await cloneAndFetch(config.url, config.localPath);
    const recentCommits = await fetchRecentTagCommits(repo);
    await printLatestTagsByCategory(recentCommits, config.tagRegex);
    await printLast5TagsWithDetails(repo);
    if (config.releaseBranchPattern) {
      await printCommitsWithPRAndJiraLinks(repo, config.releaseBranchPattern, config.url);
    }
  });
}

main();
