/*
 * The adapters' stored lists (snapshot round 2, decision 1: the owner's "store it and select at a once"), kept in the
 * worker so the content script carries none of their labels (its 1 MiB budget): an adapter declares a list's id
 * (WidgetDecl.storedList, shared/learned-lists.ts STORED_LIST_IDS), the content script asks lists/known once before a
 * step's loop for the ids its scan declares, and every scan of the run gives each widget its list as its options, so
 * it is planned on the run's first pass and chosen with one opening of its list (dom/widgets' fill.ts chooseKnown),
 * never read whole first. A page whose list differs is read as before, at that one opening (options-changed). Page
 * text only: option labels, in each list's order, as a whole read takes them.
 * - workday.countries: Workday's My Information Country dropdown, "Select One" (its first row, aria-disabled) and the
 *   249 countries of snapshot1's exelixis "Engineer II - DevSecOps.mht" (250 rows), read from the raw capture by the wd
 *   study (its open list named the applicant's own country, so that capture became fixtures/workday/
 *   s2-exelixis-country-open.html only once the converter dropped it: adapters/workday/lists.browser.test.ts checks
 *   this list against it).
 * - workday.us-states: its State dropdown while the country is the United States of America, "Select One" and the 60
 *   entries of fixtures/workday/s2-exelixis-state-open.html (snapshot1's exelixis "(1)", 61 rows).
 * - greenhouse.phone-countries: the phone's country (fieldset.phone-input's #country), "<English name> +<dial code>",
 *   "United States +1" first, then intl-tel-input's order: the same 244 pairs in
 *   src/core/matcher/phone-countries.fixture.json (four boards, 2026-10-29), fixtures/greenhouse/rushdown-country-open
 *   .html (2026-11-06) and snapshot3's Pie Insurance intl-tel-input list (2026-11-07).
 * - greenhouse.eeoc-gender, -hispanic, -veteran: the EEOC block's fixed questions, each open in snapshot3's Pie
 *   Insurance captures (fixtures/greenhouse/s2-pie-eeo-6, -7 and -8.html) and the widget capture of 2026-11-01.
 */
import type { StoredListId } from '../shared/learned-lists';

/** The row Workday draws first in every dropdown's list, aria-disabled: no answer. */
const SELECT_ONE = 'Select One';

/** Workday's Country dropdown's 249 countries, in the list's order (see the header). */
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

/** Workday's State dropdown's 60 entries while the country is the United States of America (see the header). */
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

/** Greenhouse's phone country list (see the header). */
export const GREENHOUSE_PHONE_COUNTRIES: readonly string[] = [
  'United States +1', 'Afghanistan +93', 'Åland Islands +358', 'Albania +355', 'Algeria +213', 'American Samoa +1',
  'Andorra +376', 'Angola +244', 'Anguilla +1', 'Antigua & Barbuda +1', 'Argentina +54', 'Armenia +374',
  'Aruba +297', 'Ascension Island +247', 'Australia +61', 'Austria +43', 'Azerbaijan +994', 'Bahamas +1',
  'Bahrain +973', 'Bangladesh +880', 'Barbados +1', 'Belarus +375', 'Belgium +32', 'Belize +501', 'Benin +229',
  'Bermuda +1', 'Bhutan +975', 'Bolivia +591', 'Bosnia & Herzegovina +387', 'Botswana +267', 'Brazil +55',
  'British Indian Ocean Territory +246', 'British Virgin Islands +1', 'Brunei +673', 'Bulgaria +359',
  'Burkina Faso +226', 'Burundi +257', 'Cambodia +855', 'Cameroon +237', 'Canada +1', 'Cape Verde +238',
  'Caribbean Netherlands +599', 'Cayman Islands +1', 'Central African Republic +236', 'Chad +235', 'Chile +56',
  'China +86', 'Christmas Island +61', 'Cocos (Keeling) Islands +61', 'Colombia +57', 'Comoros +269',
  'Congo - Brazzaville +242', 'Congo - Kinshasa +243', 'Cook Islands +682', 'Costa Rica +506', 'Côte d’Ivoire +225',
  'Croatia +385', 'Cuba +53', 'Curaçao +599', 'Cyprus +357', 'Czechia +420', 'Denmark +45', 'Djibouti +253',
  'Dominica +1', 'Dominican Republic +1', 'Ecuador +593', 'Egypt +20', 'El Salvador +503', 'Equatorial Guinea +240',
  'Eritrea +291', 'Estonia +372', 'Eswatini +268', 'Ethiopia +251', 'Falkland Islands +500', 'Faroe Islands +298',
  'Fiji +679', 'Finland +358', 'France +33', 'French Guiana +594', 'French Polynesia +689', 'Gabon +241',
  'Gambia +220', 'Georgia +995', 'Germany +49', 'Ghana +233', 'Gibraltar +350', 'Greece +30', 'Greenland +299',
  'Grenada +1', 'Guadeloupe +590', 'Guam +1', 'Guatemala +502', 'Guernsey +44', 'Guinea +224', 'Guinea-Bissau +245',
  'Guyana +592', 'Haiti +509', 'Honduras +504', 'Hong Kong SAR China +852', 'Hungary +36', 'Iceland +354',
  'India +91', 'Indonesia +62', 'Iran +98', 'Iraq +964', 'Ireland +353', 'Isle of Man +44', 'Israel +972',
  'Italy +39', 'Jamaica +1', 'Japan +81', 'Jersey +44', 'Jordan +962', 'Kazakhstan +7', 'Kenya +254',
  'Kiribati +686', 'Kosovo +383', 'Kuwait +965', 'Kyrgyzstan +996', 'Laos +856', 'Latvia +371', 'Lebanon +961',
  'Lesotho +266', 'Liberia +231', 'Libya +218', 'Liechtenstein +423', 'Lithuania +370', 'Luxembourg +352',
  'Macao SAR China +853', 'Madagascar +261', 'Malawi +265', 'Malaysia +60', 'Maldives +960', 'Mali +223',
  'Malta +356', 'Marshall Islands +692', 'Martinique +596', 'Mauritania +222', 'Mauritius +230', 'Mayotte +262',
  'Mexico +52', 'Micronesia +691', 'Moldova +373', 'Monaco +377', 'Mongolia +976', 'Montenegro +382',
  'Montserrat +1', 'Morocco +212', 'Mozambique +258', 'Myanmar (Burma) +95', 'Namibia +264', 'Nauru +674',
  'Nepal +977', 'Netherlands +31', 'New Caledonia +687', 'New Zealand +64', 'Nicaragua +505', 'Niger +227',
  'Nigeria +234', 'Niue +683', 'Norfolk Island +672', 'North Korea +850', 'North Macedonia +389',
  'Northern Mariana Islands +1', 'Norway +47', 'Oman +968', 'Pakistan +92', 'Palau +680',
  'Palestinian Territories +970', 'Panama +507', 'Papua New Guinea +675', 'Paraguay +595', 'Peru +51',
  'Philippines +63', 'Poland +48', 'Portugal +351', 'Puerto Rico +1', 'Qatar +974', 'Réunion +262', 'Romania +40',
  'Russia +7', 'Rwanda +250', 'Samoa +685', 'San Marino +378', 'São Tomé & Príncipe +239', 'Saudi Arabia +966',
  'Senegal +221', 'Serbia +381', 'Seychelles +248', 'Sierra Leone +232', 'Singapore +65', 'Sint Maarten +1',
  'Slovakia +421', 'Slovenia +386', 'Solomon Islands +677', 'Somalia +252', 'South Africa +27', 'South Korea +82',
  'South Sudan +211', 'Spain +34', 'Sri Lanka +94', 'St. Barthélemy +590', 'St. Helena +290', 'St. Kitts & Nevis +1',
  'St. Lucia +1', 'St. Martin +590', 'St. Pierre & Miquelon +508', 'St. Vincent & Grenadines +1', 'Sudan +249',
  'Suriname +597', 'Svalbard & Jan Mayen +47', 'Sweden +46', 'Switzerland +41', 'Syria +963', 'Taiwan +886',
  'Tajikistan +992', 'Tanzania +255', 'Thailand +66', 'Timor-Leste +670', 'Togo +228', 'Tokelau +690', 'Tonga +676',
  'Trinidad & Tobago +1', 'Tunisia +216', 'Turkey +90', 'Turkmenistan +993', 'Turks & Caicos Islands +1',
  'Tuvalu +688', 'U.S. Virgin Islands +1', 'Uganda +256', 'Ukraine +380', 'United Arab Emirates +971',
  'United Kingdom +44', 'Uruguay +598', 'Uzbekistan +998', 'Vanuatu +678', 'Vatican City +39', 'Venezuela +58',
  'Vietnam +84', 'Wallis & Futuna +681', 'Western Sahara +212', 'Yemen +967', 'Zambia +260', 'Zimbabwe +263',
];

/** EEOC "Gender" (fixtures/greenhouse/s2-pie-eeo-6.html). */
export const EEOC_GENDER: readonly string[] = ['Male', 'Female', 'Decline To Self Identify'];

/** EEOC "Are you Hispanic/Latino?" (fixtures/greenhouse/s2-pie-eeo-7.html). */
export const EEOC_HISPANIC: readonly string[] = ['Yes', 'No', 'Decline To Self Identify'];

/** EEOC "Veteran Status" (fixtures/greenhouse/s2-pie-eeo-8.html). */
export const EEOC_VETERAN: readonly string[] = ['I am not a protected veteran',
  'I identify as one or more of the classifications of a protected veteran', "I don't wish to answer"];

/** Every stored list by its id, each as a whole read takes it (Workday's with its "Select One" row first). */
export const STORED_LISTS: Readonly<Record<StoredListId, readonly string[]>> = {
  'workday.countries': [SELECT_ONE, ...WORKDAY_COUNTRIES],
  'workday.us-states': [SELECT_ONE, ...WORKDAY_US_STATES],
  'greenhouse.phone-countries': GREENHOUSE_PHONE_COUNTRIES,
  'greenhouse.eeoc-gender': EEOC_GENDER,
  'greenhouse.eeoc-hispanic': EEOC_HISPANIC,
  'greenhouse.eeoc-veteran': EEOC_VETERAN,
};

/** The stored lists of these ids (lists/known's `stored`), each once, in the order asked. */
export function storedListsOf(ids: readonly StoredListId[]): Array<{ id: StoredListId; labels: string[] }> {
  return [...new Set(ids)].map((id) => ({ id, labels: [...STORED_LISTS[id]] }));
}
