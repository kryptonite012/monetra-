import { db, type Db } from '../../db/knex';

/**
 * Automatic spending categorisation. Suggestions come from, in order:
 *   1. the user's own rules (highest priority first),
 *   2. the merchant's default category,
 *   3. Monetra's built-in dictionary of common Indian merchants and keywords.
 * Every suggestion explains where it came from.
 */
export const KEYWORD_SLUGS: Array<[RegExp, string]> = [
  [/\b(swiggy|zomato|eatsure|dominos|domino's|pizza hut|mcdonald|kfc|burger king)\b/i, 'food.delivery'],
  [/\b(bigbasket|big basket|blinkit|zepto|dmart|d-mart|grofers|jiomart|more supermarket|reliance fresh|nature'?s basket|instamart|kirana|grocery|groceries|vegetables?)\b/i, 'food.groceries'],
  [/\b(starbucks|chaayos|cafe coffee day|ccd|third wave|blue tokai|chai point)\b/i, 'food.cafes'],
  [/\b(restaurant|dhaba|diner|bistro|biryani)\b/i, 'food.restaurants'],
  [/\b(uber|ola|rapido|meru|bluesmart|auto ?rickshaw|cab)\b/i, 'transport.cab'],
  [/\b(metro|dmrc|bmrcl|best bus|ksrtc|msrtc|bus pass)\b/i, 'transport.public'],
  [/\b(petrol|diesel|hpcl|iocl|indian oil|bharat petroleum|bpcl|shell|fuel)\b/i, 'transport.fuel'],
  [/\b(fastag|toll|parking)\b/i, 'transport.tolls'],
  [/\b(irctc|redbus|abhibus)\b/i, 'travel.trains'],
  [/\b(indigo|air india|vistara|akasa|spicejet|flight)\b/i, 'travel.flights'],
  [/\b(oyo|makemytrip|goibibo|booking\.com|airbnb|hotel|treebo|fabhotel)\b/i, 'travel.hotels'],
  [/\b(netflix|hotstar|jiocinema|jio cinema|prime video|sonyliv|zee5|spotify|youtube premium|apple music|gaana)\b/i, 'entertainment.ott'],
  [/\b(bookmyshow|pvr|inox|cinepolis|concert)\b/i, 'entertainment.events'],
  [/\b(airtel|jio|vodafone|vi recharge|bsnl|prepaid|postpaid|recharge)\b/i, 'utilities.mobile'],
  [/\b(act fibernet|hathway|excitel|broadband|wifi|jiofiber|airtel xstream)\b/i, 'utilities.internet'],
  [/\b(bescom|msedcl|mahadiscom|tata power|adani electricity|bses|tneb|tangedco|cesc|torrent power|electricity|power bill)\b/i, 'utilities.electricity'],
  [/\b(water bill|jal board|bwssb)\b/i, 'utilities.water'],
  [/\b(indane|bharat gas|hp gas|lpg|piped gas|mahanagar gas|igl)\b/i, 'utilities.gas'],
  [/\b(tata play|dish tv|d2h|sun direct|dth)\b/i, 'utilities.dth'],
  [/\b(apollo pharmacy|1mg|pharmeasy|netmeds|medplus|pharmacy|chemist|medicine)\b/i, 'health.medicines'],
  [/\b(hospital|clinic|diagnostic|lab test|practo|thyrocare|dr\.? lal)\b/i, 'health.doctor'],
  [/\b(cult\.?fit|cultfit|gym|yoga)\b/i, 'health.fitness'],
  [/\b(star health|care health|niva bupa|health insurance)\b/i, 'health.insurance'],
  [/\b(lic|life insurance|term plan|hdfc life|icici pru|max life)\b/i, 'financial.life_insurance'],
  [/\b(myntra|ajio|zara|h&m|westside|pantaloons|lifestyle|bata|nykaa fashion)\b/i, 'shopping.clothing'],
  [/\b(croma|reliance digital|vijay sales|apple store)\b/i, 'shopping.electronics'],
  [/\b(nykaa|salon|spa|barber|grooming)\b/i, 'shopping.personal_care'],
  [/\b(amazon|flipkart|meesho|snapdeal|tata cliq)\b/i, 'shopping.household'],
  [/\b(rent|house rent|pg rent)\b/i, 'housing.rent'],
  [/\b(maintenance|society)\b/i, 'housing.maintenance'],
  [/\b(urban company|plumber|electrician|carpenter)\b/i, 'housing.repairs'],
  [/\b(school fee|college fee|tuition|university)\b/i, 'education.fees'],
  [/\b(udemy|coursera|byju|unacademy|upgrad|simplilearn)\b/i, 'education.courses'],
  [/\b(emi|loan repayment|bajaj finserv|home loan|car loan)\b/i, 'financial.emi'],
  [/\b(annual fee|late fee|bank charges?|sms charges|gst on fee)\b/i, 'financial.bank_charges'],
  [/\b(income tax|advance tax|gst payment|tds|property tax)\b/i, 'financial.taxes'],
  [/\b(donation|temple|charity|gift)\b/i, 'family.gifts'],
  [/\b(maid|cook|driver salary|househelp)\b/i, 'family.household_help'],
  [/\b(atm|cash withdrawal)\b/i, 'transfer.cash_withdrawal'],
  [/\b(credit card payment|cc payment|card bill)\b/i, 'transfer.card_payment'],
  [/\b(zerodha|groww|upstox|kuvera|coin|mutual fund|sip|ppf|nps)\b/i, 'transfer.savings'],
  [/\b(salary|payroll|stipend)\b/i, 'income.salary'],
  [/\b(dividend)\b/i, 'income.dividends'],
  [/\b(interest|int\.? cr|sb int)\b/i, 'income.interest'],
  [/\b(refund|cashback|reversal credit)\b/i, 'income.refunds'],
  [/\b(freelance|upwork|fiverr|consulting fee)\b/i, 'income.freelance'],
  [/\b(rent received|rental income)\b/i, 'income.rental'],
];

export interface CategorySuggestion {
  categoryId: string | null;
  categoryName: string | null;
  source: 'rule' | 'merchant' | 'keyword' | null;
  explanation: string;
}

export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|india|technologies|solutions)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export async function suggestCategory(
  userId: string,
  input: { description?: string | null; merchantName?: string | null; merchantId?: string | null; upiVpa?: string | null; kind?: 'income' | 'expense' | 'transfer' },
  conn: Db = db,
): Promise<CategorySuggestion> {
  const description = input.description ?? '';
  let merchantName = input.merchantName ?? '';
  let merchantDefault: string | null = null;
  if (input.merchantId) {
    const merchant = await conn('merchants').where({ id: input.merchantId, user_id: userId }).first('name', 'default_category_id');
    merchantName = merchant?.name ?? merchantName;
    merchantDefault = merchant?.defaultCategoryId ?? null;
  }
  const fields = { description, merchant: merchantName, upi: input.upiVpa ?? '' };

  const rules = await conn('categorization_rules as r')
    .join('transaction_categories as c', 'c.id', 'r.category_id')
    .where('r.user_id', userId)
    .whereNull('c.archived_at')
    .orderBy([{ column: 'r.priority', order: 'asc' }, { column: 'r.created_at', order: 'asc' }])
    .select('r.id', 'r.pattern', 'r.match_field', 'r.category_id', 'c.name', 'c.kind');
  for (const rule of rules) {
    if (input.kind && rule.kind !== input.kind) continue;
    const needle = String(rule.pattern).toLowerCase();
    const haystacks = rule.matchField === 'any' ? Object.values(fields) : [fields[rule.matchField as keyof typeof fields]];
    if (haystacks.some((h) => h.toLowerCase().includes(needle))) {
      await conn('categorization_rules').where({ id: rule.id }).increment('times_applied', 1);
      return { categoryId: rule.categoryId, categoryName: rule.name, source: 'rule', explanation: `Matched your rule "${rule.pattern}"` };
    }
  }

  if (merchantDefault) {
    const cat = await conn('transaction_categories').where({ id: merchantDefault }).first('name', 'kind');
    if (cat && (!input.kind || cat.kind === input.kind)) {
      return { categoryId: merchantDefault, categoryName: cat.name, source: 'merchant', explanation: `Default category for ${merchantName}` };
    }
  }

  const text = `${description} ${merchantName} ${fields.upi}`;
  for (const [re, slug] of KEYWORD_SLUGS) {
    const match = text.match(re);
    if (!match) continue;
    const cat = await conn('transaction_categories').where({ slug }).first('id', 'name', 'kind');
    if (!cat || (input.kind && cat.kind !== input.kind)) continue;
    return { categoryId: cat.id, categoryName: cat.name, source: 'keyword', explanation: `Recognised "${match[0]}"` };
  }

  return { categoryId: null, categoryName: null, source: null, explanation: 'No confident match; please choose a category' };
}
