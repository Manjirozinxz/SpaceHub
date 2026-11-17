repeat task.wait() until game:IsLoaded() and game:GetService("Players").LocalPlayer

local API = "https://SEU-DOMINIO.com/v1/script"
local KEY = getgenv().SpaceKey
if type(KEY) ~= "string" or KEY == "" then
    warn("[Space Hub] Defina getgenv().SpaceKey antes de executar o loader.")
    return
end

local function readHwid()
    local possibilities = {
        function() return gethwid and gethwid() end,
        function() return syn and syn.gethwid and syn.gethwid() end,
        function() return get_hwid and get_hwid() end,
    }
    for _, get in ipairs(possibilities) do
        local ok, value = pcall(get)
        if ok and type(value) == "string" and #value >= 8 then
            return value
        end
    end
end

local hwid = readHwid()
if not hwid then
    warn("[Space Hub] Executor sem HWID disponivel. Nao foi possivel validar a licenca.")
    return
end

local http = request or http_request or (syn and syn.request)
if type(http) ~= "function" then
    warn("[Space Hub] Executor sem suporte a requisicoes HTTP POST.")
    return
end

local HttpService = game:GetService("HttpService")
local ok, response = pcall(http, {
    Url = API,
    Method = "POST",
    Headers = { ["Content-Type"] = "application/json" },
    Body = HttpService:JSONEncode({key = KEY, hwid = hwid})
})
if not ok or type(response) ~= "table" then
    warn("[Space Hub] Falha de conexao com o servidor de licencas.")
    return
end
if tonumber(response.StatusCode) ~= 200 then
    local msg = tostring(response.Body or "Licenca recusada")
    local parsed, data = pcall(function() return HttpService:JSONDecode(msg) end)
    if parsed and type(data) == "table" then msg = tostring(data.error or msg) end
    warn("[Space Hub] " .. msg)
    return
end
local compile, err = loadstring(response.Body)
if not compile then
    warn("[Space Hub] Source invalida: " .. tostring(err))
    return
end
compile()
