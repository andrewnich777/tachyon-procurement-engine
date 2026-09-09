CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Procurement history is append-only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON procurement_events FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER quotes_immutable BEFORE UPDATE OR DELETE ON quotes FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER commands_immutable BEFORE UPDATE OR DELETE ON commands FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE UNIQUE INDEX orders_one_active_per_request ON orders(request_id) WHERE state IN ('confirmed','unknown');
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT nonnegative_order_total CHECK (total_cents >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT valid_order_state CHECK (state IN ('confirmed','unknown','failed'));
--> statement-breakpoint
ALTER TABLE actors ADD CONSTRAINT valid_actor_role CHECK (role IN ('owner','agent','reviewer','requester'));
--> statement-breakpoint
ALTER TABLE procurement_events ADD CONSTRAINT positive_event_sequence CHECK (sequence > 0);
--> statement-breakpoint
CREATE INDEX requests_workspace ON requests(workspace_id);
--> statement-breakpoint
CREATE INDEX events_workspace ON procurement_events(workspace_id);
--> statement-breakpoint
CREATE INDEX quotes_request ON quotes(request_id);
--> statement-breakpoint
CREATE INDEX orders_budget_period ON orders(workspace_id,period);
