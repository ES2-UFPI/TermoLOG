from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from comandos.models import SituacaoDoComando, TipoDeComando


class ComandoCriar(BaseModel):
    tipo: TipoDeComando
    # De 1 a 60 s: um apito mais longo que isso é incômodo, e o limite impede
    # esquecer o buzzer ligado. Valor da implementação: o contrato ainda não o define.
    duracao_s: Annotated[int, Field(ge=1, le=60)]


class ComandoParaOGateway(BaseModel):
    """O comando como o gateway o recebe na resposta do lote (contrato, 1.3)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    sensor_id: int
    tipo: TipoDeComando
    duracao_s: int
    # Em UTC (contrato), qualquer que seja o fuso da conexão com o banco.
    expira_em: Annotated[datetime, AfterValidator(lambda d: d.astimezone(UTC))]


class ComandoCriado(ComandoParaOGateway):
    """O comando como o painel o recebe ao criá-lo: ainda ``pendente``."""

    status: SituacaoDoComando = Field(validation_alias="situacao")
