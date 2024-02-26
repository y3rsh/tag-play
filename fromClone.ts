import simpleGit, { SimpleGit, LogResult, BranchSummary, DefaultLogFields } from 'simple-git';
import { promises as fs } from 'fs';
const git = simpleGit();
const monorepoUrl = 'https://github.com/Opentrons/opentrons.git';
const monorepoLocalPath = 'opentrons_repo';
const monorepoTagRegex = /^(v|ot3|docs|components|protocol-designer)/;

async function checkDirectoryExists(directoryPath: string): Promise<boolean> {
  try {
    await fs.access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function printCommitsUntilTagFound(repoPath: string, pattern: string): Promise<string | undefined> {
  const repo = simpleGit(repoPath);

  // Fetch commits from branches matching the pattern, ensuring they are in date order with from HEAD
  const commits = await repo.log({
    '--remotes': `origin/${pattern}`,
    '--pretty': 'format:%H %aI %D',
  });
  console.log(`Printing commits until a tag matching origin/${pattern} is found...`);

  // Iterate through commits and print details
  for (const commit of commits.all) {
    console.log(`${commit.hash} ${commit.date} ${commit.refs}`);

    // Check if the commit's refs include a tag
    if (commit.refs && /tag:/.test(commit.refs)) {
      console.log('Tag found in commit refs, stopping.');
      return commit.hash; // Return the commit hash if a tag is found
    }
  }

  // Return undefined if no tag is found
  return undefined;
}

async function cloneAndFetch(repoUrl: string, localPath: string): Promise<SimpleGit> {
  if (!await checkDirectoryExists(localPath)) {
    console.log(`Cloning ${repoUrl} into ${localPath}...`);
    await git.clone(repoUrl, localPath); // Use the general instance to clone
    console.log(`Repository cloned to ${localPath}.`);
  }
  const repoGit: SimpleGit = simpleGit(localPath); // Use the specific instance to work with the cloned repo
  console.log('Fetching all and tags...');
  await repoGit.fetch('--all'); // Fetch all branches
  await repoGit.fetch('--tags'); // Fetch all tags
  console.log('Fetched.');
  return repoGit;
}

interface CommitDetails {
  sha: string;
  date: string; // ISO format for easy sorting
  tags: string[]; // Include an array to store tags
}


async function fetchRecentCommits(repoGit: SimpleGit, maxCommits: number = 5000): Promise<CommitDetails[]> {
  // Custom format to include tags and other details in the log
  const customFormat = {
    hash: '%H', // Full commit hash
    date: '%aI', // Author date, strict ISO 8601 format
    refs: '%D', // Ref names, like the --decorate option of git-log
    message: '%s', // Commit message
    body: '%b', // Commit body
    author_name: '%an', // Author name
    author_email: '%ae' // Author email
  };
  // Fetch log with the custom format
  const log: LogResult = await repoGit.log({ '--max-count': maxCommits, format: customFormat });

  // Map each log entry to CommitDetails, including branches
  return log.all.map(commit => {
    const tags = commit.refs.split(', ')
      .filter(ref => ref.startsWith('tag: '))
      .map(tag => tag.replace('tag: ', ''));

    return {
      sha: commit.hash,
      date: commit.date,
      tags: tags,
    };
  });
}



async function printLatestTagsByCategory(commits: CommitDetails[], tagRegex: RegExp): Promise<void> {
  const categoryTags: { [category: string]: CommitDetails[] } = {};

  // Sort commits by date in descending order
  const sortedCommits = commits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Use an async IIFE to process the commits and tags
  await (async () => {
    for (const commit of sortedCommits) {
      for (const tag of commit.tags) {
        const match = tag.match(tagRegex);
        if (match) {
          const category = match[0];
          if (!categoryTags[category]) {
            categoryTags[category] = [];
          }
          // Ensure only the latest 5 commits are kept per category
          const isCommitAlreadyIncluded = categoryTags[category].some(storedCommit => storedCommit.sha === commit.sha);
          if (!isCommitAlreadyIncluded && categoryTags[category].length < 5) {
            categoryTags[category].push(commit);
          }
        }
      }
    }
  })();



  for (const [category, commits] of Object.entries(categoryTags)) {
    console.log('--------------CATEGORY---------------------');
    console.log(`\nCategory: ${category}, Latest 5 Commits:\n`);
    commits.forEach(commit => {
      console.log(`  SHA: ${commit.sha}`);
      console.log(`  Date: ${commit.date}`);
      console.log(`  Tags: ${commit.tags.join(', ')}`);
      console.log('-----------------------------------'); // Separator for visual distinction
    });
  }

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
  const monorepoGit = await cloneAndFetch(monorepoUrl, monorepoLocalPath)
  const recentCommits = await fetchRecentCommits(monorepoGit);
  await printLatestTagsByCategory(recentCommits, monorepoTagRegex);
  const commitWithTag = await printCommitsUntilTagFound(monorepoLocalPath, '*release*');
  if (commitWithTag) {
    await printCommitDetails(monorepoGit, commitWithTag);
  }
}

main();
