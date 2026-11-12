"""Fetch annual / quarterly / trailing statement items from Yahoo fundamentals-timeseries.

Output: data/processed/yahoo_fund.parquet  (long: id, symbol, freq, item, period_end, currency, value)
Values in units of the reporting currency (raw), as reported by Yahoo (provider-normalised; see QC report).
"""
from __future__ import annotations
import datetime as dt
import pandas as pd
from common import RAW, PROC, universe, get_json, q

ITEMS = ["TotalRevenue", "GrossProfit", "OperatingIncome", "EBIT", "EBITDA", "NormalizedEBITDA",
         "NetIncomeCommonStockholders", "NormalizedIncome", "DilutedAverageShares", "DilutedEPS", "OrdinarySharesNumber",
         "OperatingCashFlow", "CapitalExpenditure", "FreeCashFlow", "RepaymentOfDebt", "IssuanceOfDebt",
         "StockBasedCompensation", "PurchaseOfBusiness", "SaleOfBusiness", "CashDividendsPaid", "RepurchaseOfCapitalStock",
         "IssuanceOfCapitalStock", "ChangeInWorkingCapital", "InterestExpense", "InterestIncome", "DepreciationAndAmortization",
         "TotalUnusualItems", "TaxProvision", "PretaxIncome", "TotalDebt", "NetDebt", "CapitalLeaseObligations",
         "CurrentCapitalLeaseObligation", "LongTermCapitalLeaseObligation", "CashCashEquivalentsAndShortTermInvestments",
         "MinorityInterest", "StockholdersEquity", "InvestedCapital", "GoodwillAndOtherIntangibleAssets",
         "LongTermEquityInvestment", "TotalAssets", "Inventory", "AccountsReceivable", "AccountsPayable",
         "CostOfRevenue", "SellingGeneralAndAdministration", "ResearchAndDevelopment"]
P1 = int(dt.datetime(2010, 1, 1).timestamp()); P2 = int(dt.datetime(2026, 11, 13).timestamp())


def fetch(sym: str, prefix: str) -> dict:
    types = ",".join(prefix + i for i in ITEMS)
    url = (f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{q(sym)}"
           f"?type={types}&period1={P1}&period2={P2}")
    return get_json(url, RAW / "yahoo" / "fund" / f"{sym}_{prefix}.json", max_age_days=3)


def main():
    rows = []
    for _, r in universe().iterrows():
        for prefix in ("annual", "quarterly", "trailing"):
            try:
                d = fetch(r.yahoo, prefix)
            except Exception as e:
                print("FAIL", r.yahoo, prefix, e); continue
            for res in d.get("timeseries", {}).get("result", []) or []:
                t = res["meta"]["type"][0]
                for x in res.get(t, []) or []:
                    if not x:
                        continue
                    rows.append({"id": r.id, "symbol": r.yahoo, "freq": prefix, "item": t[len(prefix):],
                                 "period_end": x["asOfDate"], "period_type": x.get("periodType"),
                                 "currency": x.get("currencyCode"), "value": x["reportedValue"]["raw"]})
        print(r.id, sum(1 for z in rows if z["id"] == r.id))
    df = pd.DataFrame(rows)
    df["period_end"] = pd.to_datetime(df["period_end"])
    df.to_parquet(PROC / "yahoo_fund.parquet", index=False)


if __name__ == "__main__":
    main()
