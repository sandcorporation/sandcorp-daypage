from ninja import NinjaAPI

api = NinjaAPI(title="Daypage API", urls_namespace="api")


@api.get("/health")
def health(request):
    return {"ok": True}
