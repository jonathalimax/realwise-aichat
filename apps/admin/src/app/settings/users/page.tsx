"use client";

import { useEffect, useState } from "react";
import { getAdminUsers, createAdminUser, deleteAdminUser } from "../../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "../../../components/ui/table";

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLoginAt: string | null;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("support");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function reload() {
    setUsers(await getAdminUsers());
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate() {
    try {
      setError("");
      await createAdminUser({ email, name, role, password });
      setEmail("");
      setName("");
      setRole("support");
      setPassword("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o administrador.");
    }
  }

  async function handleDelete(id: string) {
    try {
      setError("");
      await deleteAdminUser(id);
      setConfirmingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o administrador.");
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink">Administradores</h1>

      <Card>
        <CardHeader>
          <CardTitle>Novo administrador</CardTitle>
          <CardDescription>Adiciona um acesso ao painel admin via email e senha.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@realwise.com.br" className="mt-1" />
          </div>
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" className="mt-1" />
          </div>
          <div>
            <Label>Papel</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm text-ink outline-none focus-within:border-ink/40"
            >
              <option value="support">Suporte</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
          <div>
            <Label>Senha</Label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              type="password"
              className="mt-1"
            />
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
          <Button
            className="self-start"
            onClick={handleCreate}
            disabled={!email || !name || !password || password.length < 8}
          >
            Adicionar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Administradores atuais</CardTitle>
          <CardDescription>{users.length} conta(s) com acesso ao painel admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Último login</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <td className="px-2 py-2 text-ink">{u.name}</td>
                  <td className="px-2 py-2 text-ink-soft">{u.email}</td>
                  <td className="px-2 py-2 text-ink-soft">{u.role === "superadmin" ? "Superadmin" : "Suporte"}</td>
                  <td className="px-2 py-2 text-ink-soft">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("pt-BR") : "Nunca"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {confirmingId === u.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-ink-soft">Remover?</span>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(u.id)}>
                          Confirmar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(u.id)}>
                        Remover
                      </Button>
                    )}
                  </td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
