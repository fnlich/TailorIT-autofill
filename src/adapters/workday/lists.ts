/*
 * Workday's stored lists (snapshot round 2, decision 1: the owner's "store it and select at a once"): the whole option
 * lists of My Information's Country and State dropdowns, as the owner's snapshots of 2026-11-07 show them open, so each
 * is planned on the run's first pass and chosen with one opening of its list (dom/widgets' fill.ts chooseKnown), never
 * read whole first (a read of the 250 countries took 6.4 s, view by view). Page text only: option labels, in the list's
 * order, each as its row's words read (<li role="option" data-value="..." id="..."><div>Label</div></li>); the row
 * before them, "Select One" (aria-disabled), is the list's first option and is added where a list is declared
 * (application.ts widgetFor). A tenant whose list differs is read as before, at its one opening (options-changed).
 * - WORKDAY_COUNTRIES: snapshot1, exelixis "Engineer II - DevSecOps.mht", the Country list open (250 rows: "Select
 *   One" and these 249), read from the raw capture by the wd study (its open list names the applicant's own country by
 *   aria-activedescendant, so that capture is no fixture until the converter drops it: fixtures/workday/
 *   s2-exelixis-country-open.html, once converted, is checked against this list by lists.browser.test.ts).
 * - WORKDAY_US_STATES: snapshot1, exelixis "Engineer II - DevSecOps (1).mht" (fixtures/workday/s2-exelixis-state-open
 *   .html), the State list open with "United States of America" chosen as the country (61 rows: "Select One" and these
 *   60): the 50 states, the District of Columbia, the territories and the three Armed Forces regions.
 */

import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';

/** The row Workday draws first in every dropdown's list, aria-disabled: no answer. */
export const WORKDAY_SELECT_ONE = 'Select One';

/** The country a State list holds WORKDAY_US_STATES for, as the Country dropdown shows it chosen. */
export const WORKDAY_US = 'United States of America';

/** The Country dropdown's 249 countries, in the list's order (see the header). */
export const WORKDAY_COUNTRIES: readonly string[] = [
  'Afghanistan', 'Åland Islands', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla',
  'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia',
  'Bonaire, Sint Eustatius, and Saba', 'Bosnia and Herzegovina', 'Botswana', 'Bouvet Island', 'Brazil',
  'British Indian Ocean Territory', 'British Virgin Islands', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile',
  'China', 'Christmas Island', 'Cocos (Keeling) Islands', 'Colombia', 'Comoros', 'Congo',
  'Congo, Democratic Republic of the', 'Cook Islands', 'Costa Rica', 'Côte d\'Ivoire', 'Croatia', 'Cuba', 'Curaçao',
  'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador',
  'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Falkland Islands', 'Faroe Islands', 'Fiji',
  'Finland', 'France', 'French Guiana', 'French Polynesia', 'French Southern Territories', 'Gabon', 'Gambia',
  'Georgia', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guadeloupe', 'Guam', 'Guatemala',
  'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Heard Island and McDonald Islands',
  'Holy See (Vatican City State)', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran',
  'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya',
  'Kiribati', 'Korea, Democratic People\'s Republic of', 'Korea, Republic of', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macao',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Martinique', 'Mauritania',
  'Mauritius', 'Mayotte', 'Mexico', 'Micronesia, Federated States of', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro',
  'Montserrat', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Caledonia',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island', 'Northern Mariana Islands',
  'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
  'Philippines', 'Pitcairn Islands', 'Poland', 'Portugal', 'Puerto Rico', 'Qatar', 'Reunion', 'Romania',
  'Russian Federation', 'Rwanda', 'Saint Barthelemy', 'Saint Helena, Ascension and Tristan da Cunha',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin', 'Saint Pierre and Miquelon',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal',
  'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Sint Maarten', 'Slovakia', 'Slovenia', 'Solomon Islands',
  'Somalia', 'South Africa', 'South Georgia and the South Sandwich Islands', 'South Sudan', 'Spain', 'Sri Lanka',
  'State of Palestine', 'Sudan', 'Suriname', 'Svalbard and Jan Mayen', 'Sweden', 'Switzerland', 'Syria', 'Taiwan',
  'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia',
  'Türkiye', 'Turkmenistan', 'Turks and Caicos Islands', 'Tuvalu', 'U. S. Virgin Islands', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States Minor Outlying Islands', 'United States of America',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Wallis and Futuna', 'Western Sahara', 'Yemen',
  'Zambia', 'Zimbabwe',
];

/** The State dropdown's 60 entries while the country is WORKDAY_US, in the list's order (see the header). */
export const WORKDAY_US_STATES: readonly string[] = [
  'Alabama', 'Alaska', 'American Samoa', 'Arizona', 'Arkansas', 'Armed Forces Americas', 'Armed Forces Europe',
  'Armed Forces Pacific', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida',
  'Georgia', 'Guam', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Northern Mariana Islands', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Puerto Rico', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'United States Minor Outlying Islands', 'Utah', 'Vermont',
  'Virginia', 'Virgin Islands, U.S.', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

/** A dropdown's whole list as a read takes it: Workday's "Select One" row, then the stored options. */
export function asDropdownList(options: readonly string[]): readonly string[] {
  return [WORKDAY_SELECT_ONE, ...options];
}

/** The words a dropdown's button shows while its value names an option ('' while it is empty: "Select One"). */
function chosenWords(button: Element): string {
  if ((button.getAttribute('value') ?? '').trim() === '') return '';
  return visibleText(button, { singleLine: true, cap: TEXT_CAP_LABEL });
}

/**
 * The stored list of a dropdown (application.ts widgetFor), or null: My Information's Country
 * (div[data-automation-id=formField-country] > button[name=country], fixtures/workday/s2-exelixis-state-open.html's
 * <button aria-haspopup="listbox" type="button" value="..." name="country" id="country--country">) holds
 * WORKDAY_COUNTRIES; its State (formField-countryRegion > button[name=countryRegion], id="address--countryRegion")
 * holds WORKDAY_US_STATES only while the one Country dropdown of the same step shows WORKDAY_US chosen (the list a
 * State shows depends on the country: no other country's was captured, so any other is read when it opens).
 */
export function storedListOf(button: HTMLButtonElement): readonly string[] | null {
  const field = button.closest('[data-automation-id^="formField-"]');
  const name = field?.getAttribute('data-automation-id') ?? '';
  if (name === 'formField-country' && button.name === 'country') return asDropdownList(WORKDAY_COUNTRIES);
  if (name !== 'formField-countryRegion' || button.name !== 'countryRegion') return null;
  const scope = button.closest('[data-automation-id^="applyFlow"][data-automation-id$="Page"]') ?? button.ownerDocument;
  const countries = Array.from(scope.querySelectorAll(
    '[data-automation-id="formField-country"] button[aria-haspopup="listbox" i][name="country"]'));
  if (countries.length !== 1 || chosenWords(countries[0]!) !== WORKDAY_US) return null;
  return asDropdownList(WORKDAY_US_STATES);
}
