import pytest

from ai_core.main_agent import _validate_sql


@pytest.mark.parametrize(
    "query",
    [
        "SELECT * FROM argo_profiles LIMIT 10",
        "with recent as (select * from argo_profiles order by profile_date desc limit 5) select * from recent",
    ],
)
def test_validate_sql_allows_read_only(query: str) -> None:
    _validate_sql(query)


@pytest.mark.parametrize(
    "query",
    [
        "DELETE FROM argo_profiles",
        "UPDATE argo_profiles SET latitude = 0",
        "SELECT * FROM argo_profiles; SELECT 1",
        "SELECT * FROM some_other_table",
    ],
)
def test_validate_sql_blocks_writes_or_cross_table(query: str) -> None:
    with pytest.raises(RuntimeError):
        _validate_sql(query)
