require('dotenv').config();
require('isomorphic-fetch');

const cheerio = require('cheerio');
const redis = require('redis');
const util = require('util');

const cacheTl = 100000;

const redisOptions = {
  url: 'redis://127.0.0.1:6379/0',
};

const client = redis.createClient(redisOptions);

const asyncGet = util.promisify(client.get).bind(client);
const asyncSet = util.promisify(client.set).bind(client);
const asyncFlush = util.promisify(client.flushall).bind(client);

/**
 * Listi af sviðum með „slug“ fyrir vefþjónustu og viðbættum upplýsingum til
 * að geta sótt gögn.
 */
const departments = [
  {
    name: 'Félagsvísindasvið',
    slug: 'felagsvisindasvid',
    id: 1,
  },
  {
    name: 'Heilbrigðisvísindasvið',
    slug: 'heilbrigdisvisindasvid',
    id: 2,
  },
  {
    name: 'Hugvísindasvið',
    slug: 'hugvisindasvid',
    id: 3,
  },
  {
    name: 'Menntavísindasvið',
    slug: 'menntavisindasvid',
    id: 4,
  },
  {
    name: 'Verkfræði- og náttúruvísindasvið',
    slug: 'verkfraedi-og-natturuvisindasvid',
    id: 5,
  },
];

async function getData(text) {
  const html = JSON.parse(text).html;
  const $ = cheerio.load(html);
  const headings = $('h3');
  const tables = $('table');
  const tests = [];

  headings.each((i, el) => {
    tests.push({ heading: $(el).text().trim() });
  });
  tables.each((i) => {
    const rows = $('tbody').eq(i).find('tr');
    const temp = [];
    rows.each((p, el) => {
      const course = $(el).find('td').eq(0).text();
      const name = $(el).find('td').eq(1).text();
      const type = $(el).find('td').eq(2).text();
      const students = $(el).find('td').eq(3).text();
      const date = $(el).find('td').eq(4).text();
      temp.push({
        course,
        name,
        type,
        students: Number(students),
        date,
      });
    });
    tests[i].tests = temp;
  });
  return tests;
}

async function get(url, cacheKey) {
  const cached = await asyncGet(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(url);
  const text = await response.text();
  await asyncSet(`ugla:${cacheKey}`, text, 'EX', cacheTl);
  return text;
}


async function scrape(id, slug) {
  const text = await get(`https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=${id}&notaVinnuToflu=0`, slug);
  const tests = await getData(text);
  return tests;
}

async function getIdFromSlug(slug) {
  let num;
  departments.forEach((i) => {
    if (i.slug === slug) {
      num = i.id;
    }
  });
  return num;
}

/**
 * Sækir svið eftir `slug`. Fáum gögn annaðhvort beint frá vef eða úr cache.
 *
 * @param {string} slug - Slug fyrir svið sem skal sækja
 * @returns {Promise} Promise sem mun innihalda gögn fyrir svið eða null ef það finnst ekki
 */
async function getTests(slug) {
  const num = await getIdFromSlug(slug);
  const data = await scrape(num, slug);
  return data;
}

/**
 * Hreinsar cache.
 *
 * @returns {Promise} Promise sem mun innihalda boolean um hvort cache hafi verið hreinsað eða ekki.
 */
async function clearCache() {
  return await asyncFlush();
}

/**
 * Sækir tölfræði fyrir öll próf allra deilda allra sviða.
 *
 * @returns {Promise} Promise sem mun innihalda object með tölfræði um próf
 */
async function getStats() {
  const data = [];
  await Promise.all(departments.map(async (i) => {
    const contents = await scrape(i.id, i.slug);
    data.push(contents);
  }));


  let noOfExams = 0;
  let noOfStudents = 0;
  let minStudents = Number.MAX_SAFE_INTEGER;
  let maxStudents = Number.MIN_SAFE_INTEGER;

  await Promise.all(data.map(async (i) => {
    i.forEach((j) => {
      noOfExams += j.tests.length;
      j.tests.forEach((k) => {
        if (k.students < minStudents) minStudents = k.students;
        else if (k.students > maxStudents) maxStudents = k.students;
        noOfStudents += k.students;
      });
    });
  }));
  const avgStudent = noOfStudents / noOfExams;

  return {
    min: minStudents,
    max: maxStudents,
    numTests: noOfExams,
    numStudents: noOfStudents,
    averageStudents: avgStudent,
  };
}

module.exports = {
  departments,
  getTests,
  clearCache,
  getStats,
};
