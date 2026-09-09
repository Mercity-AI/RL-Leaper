"""Render scratch-only plots; never show the trained donor as a zero-step point."""
from rl import seeker_round2_report as report
from rl.seeker_scratch import CAMPAIGN

if __name__=='__main__':
    report.CAMPAIGN=CAMPAIGN
    report.DONOR=None
    report.main()
