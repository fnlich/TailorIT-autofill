/*
 * What the synthetic Ashby page's searches know (app.ts): the geocoder's places and the school search's schools. The
 * e2e routes answer the page's searches with all of them (e2e/helpers/ashby-fixture.ts), and the page lists those whose
 * name holds the typed text, as Ashby's own answers do.
 */

/** A school as Ashby's school search lists it: its name, its country and its domain. */
export interface School {
  name: string;
  country: string;
  domain: string;
}

/** The geocoder's places (the capture's results for "Austin", and a few more). */
export const PLACES = ['Austin, Texas, United States', 'Austintown, Ohio, United States', 'Austin, Minnesota, United States',
  'Austin, Indiana, United States', 'Austin, Arkansas, United States', 'Port Austin, Michigan, United States',
  'Dallas, Texas, United States', 'Denver, Colorado, United States', 'San Francisco, California, United States'];

/** The schools the search knows: the golden profile's among its decoys. */
export const SCHOOLS: School[] = [
  { name: 'The University of Texas at Austin', country: 'United States', domain: 'utexas.edu' },
  { name: 'The University of Texas at Dallas', country: 'United States', domain: 'utdallas.edu' },
  { name: 'Austin College', country: 'United States', domain: 'austincollege.edu' },
  { name: 'Austin Community College', country: 'United States', domain: 'austincc.edu' },
  { name: 'Stanford University', country: 'United States', domain: 'stanford.edu' },
  { name: 'University of Toronto', country: 'Canada', domain: 'utoronto.ca' },
];
