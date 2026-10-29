import unittest

from jobsearch import classify as C

RATES = {"GBP": 1.0, "EUR": 0.86, "USD": 0.75, "PLN": 0.2}
NI = ["belfast", "lisburn", "dungannon", "northern ireland"]


class Salary(unittest.TestCase):
    def test_gbp_range(self):
        self.assertEqual(C.parse_salary("Salary: £30,000 - £35,000 per annum", RATES), (30000, 35000, "year"))

    def test_k_suffix_euro(self):
        lo, hi, _ = C.parse_salary("€45k–€55k", RATES)
        self.assertEqual((lo, hi), (38700, 47300))

    def test_hourly(self):
        lo, _, period = C.parse_salary("$25 per hour", RATES)
        self.assertEqual(period, "hour")
        self.assertEqual(lo, round(25 * 1950 * 0.75))

    def test_pln_monthly(self):
        lo, hi, period = C.parse_salary("12 000 - 15 000 PLN brutto / month", RATES)
        self.assertEqual(period, "month")
        self.assertEqual((lo, hi), (28800, 36000))

    def test_ignores_numbers_without_currency(self):
        self.assertIsNone(C.parse_salary("5 years experience, 24/7 rota, 300 users", RATES))

    def test_status(self):
        self.assertEqual(C.salary_status(32000, 38000, 30000), "meets")
        self.assertEqual(C.salary_status(27000, 33000, 30000), "borderline")
        self.assertEqual(C.salary_status(22000, 26000, 30000), "below")
        self.assertEqual(C.salary_status(None, None, 30000), "unknown")


class Location(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(C.eligibility("Remote - UK")[0], "uk")
        self.assertEqual(C.eligibility("Europe, USA, Canada")[0], "region")
        self.assertEqual(C.eligibility("Anywhere in the World")[0], "region")
        self.assertEqual(C.eligibility("Germany")[0], "country")
        self.assertEqual(C.eligibility("USA only")[0], "none")
        self.assertEqual(C.eligibility("")[0], "unknown")

    def test_work_mode(self):
        self.assertEqual(C.work_mode("Belfast (Hybrid)", "Service Desk Analyst", "", False, NI), "ni")
        self.assertEqual(C.work_mode("Home based - EMEA", "Support Engineer", "", False, NI), "remote")
        self.assertEqual(C.work_mode("London", "IT Support", "", False, NI), "other")
        self.assertEqual(C.work_mode("Lisburn, Northern Ireland", "Field Technician", "", False, NI), "ni")


class Other(unittest.TestCase):
    def test_contract(self):
        self.assertTrue(C.is_contract("Contract", "IT Support"))
        self.assertTrue(C.is_contract("", "6 month FTC Service Desk"))
        self.assertFalse(C.is_contract("Full-Time", "IT Support"))

    def test_languages(self):
        bonus, need = C.language_needs("Customer Support Agent (Polish speaking)", "", ["polish"], ["german"])
        self.assertEqual(bonus, ["polish"])
        _, need = C.language_needs("Support Agent", "Fluent German is required.", ["polish"], ["german"])
        self.assertEqual(need, ["german"])


if __name__ == "__main__":
    unittest.main()
