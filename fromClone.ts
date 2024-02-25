import simpleGit, { SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
const git = simpleGit();
const repoUrl = 'https://github.com/Opentrons/opentrons.git';
const localPath = './opentrons_repo';


async function checkDirectoryExists(directoryPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(directoryPath);
    return stats.isDirectory();
  } catch (error: any) {
    if (error.code === 'ENOENT') { // ENOENT is the error code for 'No such file or directory'
      return false;
    }
    throw error; // Rethrow unexpected errors
  }
}

async function cloneAndFetchTags(repoUrl: string, localPath: string): Promise<SimpleGit> {

  let repoGit: SimpleGit = simpleGit();
  if (!await checkDirectoryExists(localPath)) {

    // Capture the start time for cloning
    const cloneStartTime = Date.now();

    // Clone the repository
    console.log(`Cloning ${repoUrl}...`);
    await git.clone(repoUrl, localPath);
    console.log(`Repository shallow cloned to ${localPath}`);

    // Calculate and print the cloning time in seconds
    const cloneEndTime = Date.now();
    console.log(`Cloning Time: ${((cloneEndTime - cloneStartTime) / 1000).toFixed(2)} seconds`);

    // Change working directory to the cloned repo
    repoGit = simpleGit(localPath);
  }
  else {
    repoGit = simpleGit(localPath);
    repoGit.fetch(['--all'])
  }
  console.log('Fetching tags...');
  // Capture the start time for fetching tags
  const fetchStartTime = Date.now();
  await repoGit.fetch(['--tags']);
  // Calculate and print the fetching time in seconds
  const fetchEndTime = Date.now();
  console.log('Tags fetched.');
  console.log(`Fetching Tags Time: ${((fetchEndTime - fetchStartTime) / 1000).toFixed(2)} seconds`);
  return repoGit;
}


interface LocalTagDetails {
  name: string;
  date: string;
  sha: string;
}

async function getLocalTagDetails(tagName: string, repoGit: SimpleGit): Promise<LocalTagDetails> {
  const showData = await repoGit.show(['--name-only', '--format=%H %aI', tagName]);
  const [sha, date] = showData?.split('\n')[0].split(' ');
  console.log(`Tag: ${tagName} - SHA: ${sha} - Date: ${date}`);
  return {
    name: tagName,
    date: date || '2007-10-29T02:42:39.000-07:00', // Default date if not found
    sha,
  };
}

async function main() {
  try {
    // Clone the repository and fetch tags
    const repoGit = await cloneAndFetchTags(repoUrl, localPath);
    // get all tags
    const tags = await repoGit.tags();
    const tagCategories = ['ot3', 'v', 'docs', 'components', 'protocol-designer'];
    let filteredTags: string[] = [];

    for (const category of tagCategories) {
      // Filter tags for the current category
      const categoryTags = tags.all.filter(tagName => tagName.startsWith(category));
      filteredTags = filteredTags.concat(categoryTags);
    }

    // Fetch details for filtered tags
    const tagDetailsPromises = filteredTags.map(tagName => getLocalTagDetails(tagName, repoGit!));
    let tagDetails = await Promise.all(tagDetailsPromises);

    // Print the first 10 tags for the current category by date most recent first
    tagDetails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    //console.log('First 10 Tags by date most recent first:');
    //tagDetails.slice(0, 10).forEach(tag => console.log(`${tag.name} - SHA: ${tag.sha} - Date: ${tag.date}`));

  } catch (error) {
    console.error(`Error processing tags: ${error}`);
  }
}

main();
