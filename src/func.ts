// process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
import * as fs from 'fs-extra';
import * as path from 'path';
import fetch from 'node-fetch';
import { Page, launch } from 'puppeteer';
import Sitemapper from 'sitemapper';
import { Semaphore } from 'await-semaphore';

interface pageDetail {
  page: Page;
  usable: boolean;
}

interface deadLink {
  page: string;
  authors?: (string | null)[];
  links?: linkDetail[];
  error?: Error;
}

interface linkDetail {
  link: string | null;
  error: string;
}

const SITEMAP_PAGES_URL = 'https://trap.jp/sitemap-pages.xml';
const SITEMAP_POSTS_URL = 'https://trap.jp/sitemap-posts.xml';
const INTERVAL_MS = 5000;
const SEMAPHORE_COUNT = 3;
const sitemap = new Sitemapper({ timeout: 10000 });
const fetchSema = new Semaphore(5);
const crawlSema = new Semaphore(SEMAPHORE_COUNT);
const pages: pageDetail[] = [];
const deadLinks: deadLink[] = [];

const findDeadLinks = async () => {
  // 1. initialize
  const { sites: pages_urls } = await sitemap.fetch(SITEMAP_PAGES_URL);
  const { sites: posts_urls } = await sitemap.fetch(SITEMAP_POSTS_URL);
  const urls = pages_urls.concat(posts_urls);
  // 2. open a new browser and tabs;
  const browser = await launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  for (let i = 0; i < SEMAPHORE_COUNT; i++) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.resourceType() !== 'document') {
        return r.abort();
      }
      return r.continue();
    });
    pages.push({ page: page, usable: true });
  }
  // 3. crawl links
  console.log(`Start checking ${urls.length} pages...`);
  await Promise.all(urls.map((url) => crawlLink(url)));
  // 4. close the browser
  await browser.close();
  // 5. recheck errored links
  for (let i = 0; i < deadLinks.length; i++) {
    const links = deadLinks[i].links;
    if (links) {
      const refetchedLinks = await Promise.all(
        links.map((elm) => refetchLink(elm))
      );
      const dl = refetchedLinks.filter((link) => link.error !== '');
      deadLinks[i].links = dl;
    }
  }
  deadLinks.filter((dl) => dl.links && dl.links.length > 0);
  //6. output to json file
  await fs.outputJSON(path.join(__dirname, '../deadLinks.json'), deadLinks, {
    spaces: '\t',
  });
  console.log('Finished checking.');
  return deadLinks;
};

export { findDeadLinks };

const crawlLink = async (url: string) => {
  const release = await crawlSema.acquire();
  const i = usablePageIndex();
  const page = pages[i].page;
  console.log(`Page${i}: Checking ${url}`);
  try {
    await page.goto(url);
  } catch (err) {
    console.log(`Page${i}: Error at ${url}:\n\t${err}`);
    deadLinks.push({
      page: url,
      error: err,
    });
    pages[i].usable = true;
    await wait();
    release();
    return;
  }
  const links = await page.$$eval('article a', (elms) =>
    elms.map((elm) => elm.getAttribute('href'))
  );
  const authors = await page.$$eval('.author-detail > a', (elms) =>
    elms.map((elm) => elm.getAttribute('href'))
  );
  const fetchedLinks = await Promise.all(links.map((link) => fetchLink(link)));
  const dl = fetchedLinks.filter((link) => link.error !== '');
  if (dl.length > 0) {
    deadLinks.push({
      page: url,
      authors: authors,
      links: dl,
    });
  }
  pages[i].usable = true;
  await wait();
  release();
  return;
};

const usablePageIndex = () => {
  for (let i = 0; i < SEMAPHORE_COUNT; i++) {
    if (pages[i].usable) {
      pages[i].usable = false;
      return i;
    }
  }
  return -1;
};

const fetchLink = async (link: string | null): Promise<linkDetail> => {
  const release = await fetchSema.acquire();
  if (!link || !link.startsWith('http') || link.includes('/content/images')) {
    release();
    return { link, error: '' };
  }
  try {
    const fetched = await fetch(link, {
      redirect: 'follow',
      follow: 20,
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36',
      },
    });
    if (fetched.status === 200) {
      release();
      return { link, error: '' };
    } else {
      console.log(`\tDead Link Found: ${link} ${fetched.status}`);
      release();
      return { link, error: `${fetched.status} ${fetched.statusText}` };
    }
  } catch (err) {
    console.log(`\tError Page Found: ${link} ${err}`);
    release();
    return { link, error: `${err}` };
  }
};

const refetchLink = async (elm: linkDetail) => {
  const release = await fetchSema.acquire();
  // 500番台 or 429
  if (elm.error.match(/^(5[0-9]{2}|429)/)) {
    await wait();
    console.log(`    Rechecking ${elm.link}`);
    return await fetchLink(elm.link);
  }
  release();
  return elm;
};

const wait = async (times = 1) => {
  await new Promise((resolve) => {
    setTimeout(resolve, INTERVAL_MS * times);
  });
};
