import simpleGit, { SimpleGit, LogResult } from 'simple-git';
import { promises as fs } from 'fs';
const git = simpleGit();
const repoUrl = 'https://github.com/Opentrons/opentrons.git';
const localPath = 'opentrons_repo';

async function checkDirectoryExists(directoryPath: string): Promise<boolean> {
  try {
    await fs.access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function cloneAndFetch(repoUrl: string, localPath: string): Promise<SimpleGit> {
  if (!await checkDirectoryExists(localPath)) {
    console.log(`Cloning ${repoUrl} into ${localPath}...`);
    await git.clone(repoUrl, localPath); // Use the general instance to clone
    console.log(`Repository cloned to ${localPath}.`);
  }
  const repoGit: SimpleGit  = simpleGit(localPath); // Use the specific instance to work with the cloned repo
  console.log('Fetching all and tags...');
  await repoGit.fetch('--all'); // Fetch all branches
  await repoGit.fetch('--tags'); // Fetch all tags
  console.log('Fetched.');
  return repoGit;
}


interface CommitDetails {
  sha: string;
  date: string; // ISO format for easy sorting
}

interface TagDetails {
  name: string;
  sha: string;
  date: string;
}

async function fetchRecentCommits(repoGit: SimpleGit, maxCommits: number = 3500): Promise<CommitDetails[]> {
  const log: LogResult = await repoGit.log({ '--max-count': maxCommits });
  return log.all.map(commit => ({
    sha: commit.hash,
    date: commit.date // The date is in ISO format by default
  }));
}

async function fetchTagsForCommits(repoGit: SimpleGit, commits: CommitDetails[]): Promise<TagDetails[]> {
  const tagsRef = await repoGit.raw(['show-ref', '--tags']);
  const allTags = tagsRef.split('\n').filter(line => !!line).map(line => {
    const [sha, ref] = line.split(' ');
    const name = ref.replace('refs/tags/', '');
    return { name, sha };
  });

  const tagsWithDate: TagDetails[] = [];
  for (const commit of commits) {
    const tagsForCommit = allTags.filter(tag => tag.sha.startsWith(commit.sha));
    tagsForCommit.forEach(tag => {
      tagsWithDate.push({ ...tag, date: commit.date });
    });
  }

  return tagsWithDate;
}

async function main() {
  const repoGit = await cloneAndFetch(repoUrl, localPath)
  const recentCommits = await fetchRecentCommits(repoGit);
  const tags = await fetchTagsForCommits(repoGit, recentCommits);

  // Now you have tags with dates, and you can sort them as needed
  const sortedTags = tags.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // print the last 10 sorted tags
  console.log(sortedTags.slice(0, 10));
}

main();
