from datetime import UTC, datetime, timedelta, timezone

# O Brasil não tem horário de verão desde 2019, então o fuso de Brasília é fixo.
BRASILIA = timezone(timedelta(hours=-3))


def em_utc(data: datetime | None) -> datetime | None:
    """O contrato pede datas com fuso; uma data sem fuso vale como UTC (#87)."""
    if data is None or data.tzinfo is not None:
        return data
    return data.replace(tzinfo=UTC)
